# AI Drone Lab — generated fixed-template ArduCopter SITL script
# Static checks are not SITL verification or real-flight approval.
# ENU launch origin; align to NORTH (0 degrees) after takeoff before moving.
# Run: python mission.py --check
# Flight: python mission.py --execute-sitl --connect tcp:127.0.0.1:5760

# 學習區：依序下達飛行指令（公尺、秒、度）
def run_mission(drone):
    # 1. 起飛 3m
    drone.takeoff(altitude=3)
    # 2. 懸停 2s
    drone.hover(duration=2)
    # 3. 降落
    drone.land()


# 以下是共用控制函式庫；初學者可先閱讀上方學習區。
"""AI Drone Lab fixed runtime. No dependency imports or flight on --check.
ENU: east/north/up metres; heading north=0, clockwise degrees.
LOCAL_NED targets include the measured EKF-to-launch offset, never assume zero.
"""
import argparse
import ast
import base64
import hashlib
import importlib.metadata
import json
import math
import platform
import re
import sys
import time
from contextlib import contextmanager


def request_copter_mode(vehicle, mode, mavlink):
    """Use SET_MODE, supported by Copter 3.3 and current ArduPilot.
    Recent pymavlink Vehicle.mode setters use DO_SET_MODE, rejected by Copter 3.3.
    Only the two modes used by this fixed template are permitted.
    """
    mode_ids = {'GUIDED': 4, 'LAND': 9}
    message = vehicle.message_factory.set_mode_encode(
        0, mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode_ids[mode.name])
    vehicle.send_mavlink(message)


class FlightCommands:
    """Teaching API: explicit calls are checked against the validated flight plan.
    This is AI Drone Lab's implemented helper, not a native DroneKit API.
    Changing a call requires regenerating the validated plan from the web editor.
    """
    def __init__(self, controller, plan):
        self.controller, self.plan, self.index = controller, plan, 0
        self.group = None

    def _command(self, action, **parameters):
        command = dict(action=action, **{k: v for k, v in parameters.items() if v is not None})
        if self.group is not None:
            self.group.append(command)
            return
        if self.index >= len(self.plan['steps']) or command != self.plan['steps'][self.index]['command']:
            raise ValueError('Flight instruction differs from validated mission; regenerate the script')
        if self.controller is not None:
            self.controller.execute_step(self.index)
        self.index += 1

    def finish(self):
        if self.index != len(self.plan['steps']) or self.group is not None:
            raise ValueError('Missing flight instructions')

    def takeoff(self, altitude, speed=None):
        self._command('takeoff', altitude=altitude, speed=speed)

    def land(self):
        self._command('land')

    def move_forward(self, distance, speed=None):
        self._command('move_forward', distance=distance, speed=speed)

    def move_backward(self, distance, speed=None):
        self._command('move_backward', distance=distance, speed=speed)

    def move_left(self, distance, speed=None):
        self._command('move_left', distance=distance, speed=speed)

    def move_right(self, distance, speed=None):
        self._command('move_right', distance=distance, speed=speed)

    def ascend(self, distance, speed=None):
        self._command('ascend', distance=distance, speed=speed)

    def descend(self, distance, speed=None):
        self._command('descend', distance=distance, speed=speed)

    def turn_left(self, angle, speed=None):
        self._command('turn_left', angle=angle, speed=speed)

    def turn_right(self, angle, speed=None):
        self._command('turn_right', angle=angle, speed=speed)

    def change_altitude(self, altitude, speed=None):
        self._command('change_altitude', altitude=altitude, speed=speed)

    def set_heading(self, heading, direction=None, speed=None):
        self._command('set_heading', heading=heading, direction=direction, speed=speed)

    def set_speed(self, speed, vertical_speed=None):
        self._command('set_speed', speed=speed, vertical_speed=vertical_speed)

    def goto_local(self, x, y, z, speed=None):
        self._command('goto_local', x=x, y=y, z=z, speed=speed)

    def goto_gps(self, latitude, longitude, altitude, speed=None):
        self._command('goto_gps', latitude=latitude, longitude=longitude, altitude=altitude, speed=speed)

    def hover(self, duration):
        self._command('hover', duration=duration)

    @contextmanager
    def parallel(self, reference_frame=None):
        """Collect the block's independent axes and execute them simultaneously."""
        if self.group is not None:
            raise ValueError('Nested parallel blocks are not supported')
        self.group = []
        try:
            yield
            commands = self.group
        finally:
            self.group = None
        self._command('parallel', commands=commands, reference_frame=reference_frame)


def trajectory_pose(t, q):
    start = t['start']
    h0 = math.radians(start['heading'])
    delta = math.radians(t['heading'])
    h = h0 + delta * q
    f, r = t['forward'], t['right']
    east = (f * math.sin(h0) + r * math.cos(h0)) * q
    north = (f * math.cos(h0) - r * math.sin(h0)) * q
    if t['frame'] == 'body' and abs(delta) > 1e-9:
        east = (f * (math.cos(h0) - math.cos(h)) + r * (math.sin(h) - math.sin(h0))) / delta
        north = (f * (math.sin(h) - math.sin(h0)) + r * (math.cos(h) - math.cos(h0))) / delta
    return dict(east=start['east'] + east, north=start['north'] + north,
                up=start['up'] + t['up'] * q, heading=start['heading'] + t['heading'] * q)


def sample(t, seconds):
    u = max(0.0, min(1.0, seconds / t['duration']))
    q, rate = u*u*(3-2*u), 6*u*(1-u)/t['duration']
    p = trajectory_pose(t, q)
    h = math.radians(p['heading'] if t['frame'] == 'body' else t['start']['heading'])
    v = dict(east=(t['forward']*math.sin(h)+t['right']*math.cos(h))*rate,
             north=(t['forward']*math.cos(h)-t['right']*math.sin(h))*rate,
             up=t['up']*rate)
    return p, v


def distance(a, b):
    return math.sqrt(sum((a[k]-b[k])**2 for k in ('east', 'north', 'up')))


def angle_error(a, b):
    return (a-b+180) % 360-180


def check_plan(plan):
    # The browser compiler already applies the canonical schema and analytic fence checks.
    # These additional guards also run before importing DroneKit or opening any socket.
    limits = plan['limits']
    steps = plan['steps']
    allowed = {'takeoff', 'land', 'move_forward', 'move_backward', 'move_left', 'move_right',
               'ascend', 'descend', 'turn_left', 'turn_right', 'hover', 'set_speed',
               'change_altitude', 'set_heading', 'goto_local', 'goto_gps', 'parallel'}
    if not steps or len(steps) > limits['maxCommands']:
        raise ValueError('Invalid expanded command count')
    if steps[-1]['command']['action'] != 'land':
        raise ValueError('A mission must end with LAND')
    if sum(s['command']['action'] == 'takeoff' for s in steps) != 1:
        raise ValueError('Exactly one takeoff required')
    for s in steps:
        if s['command']['action'] not in allowed:
            raise ValueError('Unsupported command')
        points = [s['target']]
        if 'trajectory' in s:
            points += [trajectory_pose(s['trajectory'], i/720) for i in range(721)]
        for p in points:
            if not all(math.isfinite(p[k]) for k in ('east', 'north', 'up', 'heading')):
                raise ValueError('Non-finite target')
            if math.hypot(p['east'], p['north']) > limits['radius'] + 1e-7 or not 0 <= p['up'] <= limits['maxAltitude']:
                raise ValueError('Target outside fence')
        for axis, maximum in [('horizontal', limits['maxSpeed']), ('vertical', limits['verticalSpeed']), ('yaw', limits['yawSpeed'])]:
            if not 0 < s['speeds'][axis] <= maximum:
                raise ValueError('Invalid speed')
    return True


class DroneController:
    def __init__(self, vehicle, plan, vehicle_mode, mavlink):
        self.v, self.plan, self.mode, self.mav = vehicle, plan, vehicle_mode, mavlink
        self.started = time.monotonic()
        self.launch = None
        self.ground_alt = None
        self.last = None
        self.owns_flight = False
        self.step_deadline = None
        self.last_yaw_target = None
        self.last_yaw_time = None
        self.yaw_speed = plan['limits']['yawSpeed']

    def wait(self, predicate, timeout, label, flight=False):
        deadline = time.monotonic() + timeout
        while True:
            if flight:
                self.guard()
            if predicate():
                return
            if time.monotonic() > deadline:
                raise TimeoutError(label)
            time.sleep(0.1)

    def telemetry_ready(self, require_local=True):
        p = self.v.location.local_frame
        g = self.v.location.global_relative_frame
        values = [g.alt, g.lat, g.lon, self.v.heading]
        if require_local:
            values += [p.north, p.east, p.down]
        return all(x is not None and math.isfinite(x) for x in values)

    def change_mode(self, name, timeout=10):
        deadline, next_send = time.monotonic()+timeout, 0
        initial = self.v.mode.name
        while self.v.mode.name != name:
            if self.v.mode.name != initial:
                raise RuntimeError('Mode changed externally while waiting for '+name)
            if self.v.last_heartbeat is None or self.v.last_heartbeat > 3:
                raise RuntimeError('Heartbeat lost while waiting for '+name)
            now = time.monotonic()
            if now > deadline:
                raise TimeoutError('%s timeout: current mode=%s; no arming/flight continuation' % (name, self.v.mode.name))
            if now >= next_send:
                print('SET_MODE:', initial, '->', name, flush=True)
                request_copter_mode(self.v, self.mode(name), self.mav)
                next_send = now+1
            time.sleep(0.1)

    def prepare(self):
        print('PRE-ARM:', 'mode=', self.v.mode.name, 'armed=', self.v.armed,
              'is_armable=', self.v.is_armable, 'GPS fix=', self.v.gps_0.fix_type,
              'heading=', self.v.heading, 'local=', self.v.location.local_frame, flush=True)
        if self.v.armed:
            raise RuntimeError('Refusing to start: vehicle is already armed')
        if self.v._vehicle_type != self.mav.MAV_TYPE_QUADROTOR:
            raise RuntimeError('This template is restricted to a quadrotor SITL')
        print('Waiting for pre-arm readiness and 3D GPS (local NED is checked AFTER arming)...', flush=True)
        self.wait(lambda: self.v.is_armable and self.telemetry_ready(require_local=False) and self.v.gps_0.fix_type >= 3,
                  60, 'Pre-arm/GPS timeout')
        if abs(angle_error(self.v.heading, self.plan['origin']['heading'])) > 5:
            print('Initial heading %.1f; after takeoff, align to compiled heading %.1f before moving.' %
                  (self.v.heading, self.plan['origin']['heading']), flush=True)
        home = self.plan['mission'].get('home')
        if home:
            g = self.v.location.global_relative_frame
            separation = math.hypot(math.radians(g.lat-home['latitude'])*6378137,
                                    math.radians(g.lon-home['longitude'])*6378137*math.cos(math.radians(g.lat)))
            if separation > 1:
                raise RuntimeError('GPS mission.home must match SITL launch within 1 metre')
        self.change_mode('GUIDED')

    def capture_launch(self):
        # LOCAL_POSITION_NED may only become available after arming. Never fake zero.
        print('ARMED: waiting for local NED before takeoff (maximum 15 seconds)...', flush=True)
        deadline = time.monotonic()+15
        while True:
            if self.v.mode.name != 'GUIDED' or not self.v.armed:
                raise RuntimeError('Mode changed or disarmed while waiting for local NED')
            if self.v.last_heartbeat is None or self.v.last_heartbeat > 3:
                raise RuntimeError('Heartbeat lost while waiting for local NED')
            if self.telemetry_ready():
                p = self.v.location.local_frame
                self.launch = dict(north=p.north, east=p.east, down=p.down)
                self.ground_alt = self.v.location.global_relative_frame.alt
                print('Launch NED:', self.launch, flush=True)
                return
            if time.monotonic() > deadline:
                raise TimeoutError('Local NED unavailable after arming; no takeoff command sent')
            time.sleep(0.1)

    def pose(self):
        if not self.telemetry_ready():
            raise RuntimeError('Position telemetry unavailable')
        p = self.v.location.local_frame
        return dict(east=p.east-self.launch['east'], north=p.north-self.launch['north'],
                    up=self.launch['down']-p.down, heading=self.v.heading)

    def guard(self, landing=False):
        if self.step_deadline is not None and time.monotonic() > self.step_deadline:
            raise TimeoutError('Command time exceeded')
        if time.monotonic()-self.started > self.plan['limits']['maxDuration']:
            raise TimeoutError('Mission total time exceeded')
        if self.v.last_heartbeat is None or self.v.last_heartbeat > 3:
            raise RuntimeError('Heartbeat lost')
        if self.v.mode.name != ('LAND' if landing else 'GUIDED'):
            raise RuntimeError('Flight mode changed; operator/failsafe has control')
        p = self.pose()
        # LAND may report slightly negative EKF altitude near ground. Keep the
        # horizontal/ceiling fence, but do not interrupt landing for that estimate.
        if math.hypot(p['east'], p['north']) > self.plan['limits']['radius']+0.5 or p['up'] > self.plan['limits']['maxAltitude']+0.5 or (not landing and p['up'] < -0.5):
            raise RuntimeError('Measured position outside safety fence: %s (landing=%s)' % (p, landing))
        if not landing and not self.v.armed:
            raise RuntimeError('Unexpected disarm')

    def send_target(self, p, velocity=None):
        v = velocity or dict(east=0, north=0, up=0)
        # Ignore acceleration XYZ (64+128+256) and yaw rate (2048).
        # Position XYZ + velocity XYZ + absolute yaw are all enabled: mask=2496.
        message = self.v.message_factory.set_position_target_local_ned_encode(
            0, 0, 0, self.mav.MAV_FRAME_LOCAL_NED, 2496,
            self.launch['north']+p['north'], self.launch['east']+p['east'], self.launch['down']-p['up'],
            v['north'], v['east'], -v['up'], 0, 0, 0, math.radians(p['heading'] % 360), 0)
        self.v.send_mavlink(message)
        # CONDITION_YAW also works with older Copter versions that ignore yaw
        # fields in SET_POSITION_TARGET_LOCAL_NED. Send position before yaw.
        yaw = p['heading'] % 360
        now = time.monotonic()
        if self.v.mode.name == 'GUIDED' and (self.last_yaw_target is None or abs(angle_error(yaw, self.last_yaw_target)) >= 1 or now-self.last_yaw_time >= 2):
            direction = 1 if angle_error(yaw, self.v.heading) >= 0 else -1
            message = self.v.message_factory.command_long_encode(
                0, 0, self.mav.MAV_CMD_CONDITION_YAW, 0,
                yaw, self.yaw_speed, direction, 0, 0, 0, 0)
            self.v.send_mavlink(message)
            self.last_yaw_target, self.last_yaw_time = yaw, now

    def reached(self, target):
        p = self.pose()
        velocity = self.v.velocity
        return (distance(p, target) < 0.35 and abs(angle_error(p['heading'], target['heading'])) < 3
                and velocity is not None and all(x is not None and math.isfinite(x) for x in velocity)
                and math.sqrt(sum(x*x for x in velocity)) < 0.3)

    def settle(self, target, timeout=15):
        deadline, stable = time.monotonic()+timeout, None
        while True:
            self.guard()
            self.send_target(target)
            now = time.monotonic()
            stable = (stable or now) if self.reached(target) else None
            if stable is not None and now-stable >= 0.5:
                return
            if now > deadline:
                raise TimeoutError('Target position/heading/velocity did not settle')
            time.sleep(0.1)

    def takeoff(self, step):
        # Limit automatic climb rate using ArduCopter's actual cm/s parameter.
        self.v.parameters['WPNAV_SPEED_UP'] = step['speeds']['vertical']*100
        self.wait(lambda: self.v.parameters.get('WPNAV_SPEED_UP') is not None and abs(self.v.parameters.get('WPNAV_SPEED_UP')-step['speeds']['vertical']*100) < 1,
                  5, 'Climb speed parameter acknowledgement timeout')
        self.owns_flight = True
        self.v.armed = True
        self.wait(lambda: self.v.armed, 10, 'Arm timeout')
        self.capture_launch()
        self.v.simple_takeoff(self.ground_alt+step['target']['up'])
        self.wait(lambda: abs(self.pose()['up']-step['target']['up']) < 0.25,
                  self.plan['limits']['commandTimeout'], 'Takeoff altitude timeout', flight=True)
        self.settle(step['target'])

    def track(self, step):
        target = step['target']
        t = step.get('trajectory')
        if not t:
            start = self.last
            h = math.radians(start['heading'])
            e, n = target['east']-start['east'], target['north']-start['north']
            up, yaw = target['up']-start['up'], target['heading']-start['heading']
            speeds = step['speeds']
            duration = max(0.5, 1.5*max(math.hypot(e, n)/speeds['horizontal'], abs(up)/speeds['vertical'], abs(yaw)/speeds['yaw']))
            t = dict(start=start, frame='start', forward=e*math.sin(h)+n*math.cos(h),
                     right=e*math.cos(h)-n*math.sin(h), up=up, heading=yaw, duration=duration)
        deadline, elapsed, previous = time.monotonic()+self.plan['limits']['commandTimeout'], 0.0, time.monotonic()
        while elapsed < t['duration']:
            self.guard()
            now = time.monotonic()
            if now > deadline:
                raise TimeoutError('Trajectory timeout')
            p, v = sample(t, elapsed)
            actual = self.pose()
            catching_up = distance(actual, p) > 1 or abs(angle_error(actual['heading'], p['heading'])) > 20
            self.send_target(p, None if catching_up else v)
            if not catching_up:
                elapsed += min(now-previous, 0.2)
            previous = now
            time.sleep(0.1)
        self.settle(target, max(0.1, deadline-time.monotonic()))

    def hover(self, target, seconds):
        deadline = time.monotonic()+seconds
        while time.monotonic() < deadline:
            self.guard()
            self.send_target(target)
            time.sleep(0.1)

    def land(self):
        self.change_mode('LAND')
        deadline = time.monotonic()+self.plan['limits']['commandTimeout']
        while self.v.armed:
            self.guard(landing=True)
            if time.monotonic() > deadline:
                raise TimeoutError('LAND/disarm timeout; never force disarm in flight')
            time.sleep(0.1)
        if self.pose()['up'] > 0.5:
            raise RuntimeError('Disarmed above ground')

    def execute_step(self, index):
        self.step_deadline = time.monotonic()+self.plan['limits']['commandTimeout']
        step = self.plan['steps'][index]
        self.yaw_speed = step['speeds']['yaw']
        print('STEP', index+1, step['sourcePath'], step['command']['action'], flush=True)
        action = step['command']['action']
        if action == 'set_speed':
            self.v.groundspeed = step['speeds']['horizontal']
        elif action == 'takeoff':
            self.takeoff(step)
        elif action == 'land':
            self.land()
        elif action == 'hover':
            self.settle(step['target'])
            self.hover(step['target'], step['command']['duration'])
        else:
            self.track(step)
        self.last = step['target']


def main():
    parser = argparse.ArgumentParser(description='AI Drone Lab: local ArduCopter SITL only; not certified for real flight')
    parser.add_argument('--connect', default='tcp:127.0.0.1:5760')
    parser.add_argument('--execute-sitl', action='store_true', help='Explicitly allow arming the local SITL')
    parser.add_argument('--check', action='store_true', help='Syntax and compiled-plan checks only; no sockets/imports')
    args = parser.parse_args()
    ast.parse(open(__file__, encoding='utf-8').read(), filename=__file__)
    payload = base64.b64decode(PLAN_B64)
    if hashlib.sha256(payload).hexdigest() != PLAN_SHA256:
        raise ValueError('Compiled mission integrity check failed; regenerate from the web interface')
    plan = json.loads(payload)
    check_plan(plan)
    preview = FlightCommands(None, plan)
    run_mission(preview)
    preview.finish()
    print('Python', platform.python_version(), '| Static checks passed | SITL NOT verified')
    if args.check or not args.execute_sitl:
        print('CHECK ONLY: no connection opened and no flight commands sent. '
              'To fly a confirmed local SITL, add --execute-sitl '
              '--connect tcp:127.0.0.1:5760', flush=True)
        return
    if not re.fullmatch(r'tcp:127\.0\.0\.1:[0-9]{1,5}', args.connect):
        raise ValueError('Only explicit loopback TCP SITL endpoints are accepted')
    if sys.version_info[:2] != (3, 9):
        raise RuntimeError('Use the isolated Python 3.9 candidate environment; other versions are unverified')
    from dronekit import connect, VehicleMode
    from pymavlink import mavutil
    print('DroneKit', importlib.metadata.version('dronekit'), 'pymavlink', importlib.metadata.version('pymavlink'))
    vehicle = None
    controller = None
    original_climb = None
    try:
        print('CONNECTING:', args.connect, '(maximum 60 seconds; heartbeat timeout 10 seconds)', flush=True)
        vehicle = connect(args.connect, wait_ready=True, timeout=60, heartbeat_timeout=10)
        print('ArduPilot reported version:', vehicle.version)
        if vehicle._autopilot_type != mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA:
            raise RuntimeError('ArduPilot required')
        # Older dronekit-sitl firmware may not expose SIM_SPEEDUP.
        # Accept the simulator wind parameter group as a legacy signature instead.
        simulator_parameters = ('SIM_WIND_SPD', 'SIM_WIND_DIR', 'SIM_WIND_TURB')
        speedup = vehicle.parameters.get('SIM_SPEEDUP')
        legacy_sim = all(vehicle.parameters.get(name) is not None for name in simulator_parameters)
        if speedup is None and not legacy_sim:
            raise RuntimeError('No supported SITL parameter signature: expected SIM_SPEEDUP or '
                               'SIM_WIND_SPD/SIM_WIND_DIR/SIM_WIND_TURB; refusing to arm')
        print('SITL parameter signature:', 'SIM_SPEEDUP' if speedup is not None else
              'legacy SIM_WIND_SPD/SIM_WIND_DIR/SIM_WIND_TURB', flush=True)
        controller = DroneController(vehicle, plan, VehicleMode, mavutil.mavlink)
        controller.prepare()
        original_climb = vehicle.parameters.get('WPNAV_SPEED_UP')
        if original_climb is None:
            raise RuntimeError('WPNAV_SPEED_UP required for bounded takeoff speed')
        controller.started = time.monotonic()
        commands = FlightCommands(controller, plan)
        run_mission(commands)
        commands.finish()
        print('Mission completed and disarmed. This run alone is not real-flight certification.')
    except (Exception, KeyboardInterrupt):
        # Do not override an operator/failsafe mode change. Never force disarm.
        if vehicle is not None and vehicle.armed and controller is not None and controller.owns_flight and vehicle.mode.name == 'GUIDED':
            request_copter_mode(vehicle, VehicleMode('LAND'), mavutil.mavlink)
            deadline = time.monotonic()+60
            next_send = time.monotonic()+1
            while vehicle.armed and vehicle.mode.name in ('GUIDED', 'LAND') and time.monotonic() < deadline:
                if vehicle.mode.name == 'GUIDED' and time.monotonic() >= next_send:
                    request_copter_mode(vehicle, VehicleMode('LAND'), mavutil.mavlink)
                    next_send = time.monotonic()+1
                time.sleep(0.2)
        raise
    finally:
        if vehicle is not None:
            try:
                if original_climb is not None:
                    vehicle.parameters['WPNAV_SPEED_UP'] = original_climb
            finally:
                vehicle.close()


PLAN_B64 = "eyJtaXNzaW9uIjp7InZlcnNpb24iOiIxLjAiLCJuYW1lIjoi6Ieq5YuV6LW36aOb6IiH6ZmN6JC9IiwiY29tbWFuZHMiOlt7ImFjdGlvbiI6InRha2VvZmYiLCJhbHRpdHVkZSI6M30seyJhY3Rpb24iOiJob3ZlciIsImR1cmF0aW9uIjoyfSx7ImFjdGlvbiI6ImxhbmQifV19LCJvcmlnaW4iOnsiZWFzdCI6MCwibm9ydGgiOjAsInVwIjowLCJoZWFkaW5nIjowfSwic3RlcHMiOlt7ImNvbW1hbmQiOnsiYWN0aW9uIjoidGFrZW9mZiIsImFsdGl0dWRlIjozfSwic291cmNlUGF0aCI6Ii9jb21tYW5kcy8wIiwidGFyZ2V0Ijp7ImVhc3QiOjAsIm5vcnRoIjowLCJ1cCI6MywiaGVhZGluZyI6MH0sInNwZWVkcyI6eyJob3Jpem9udGFsIjoyLjUsInZlcnRpY2FsIjoxLjIsInlhdyI6NjB9fSx7ImNvbW1hbmQiOnsiYWN0aW9uIjoiaG92ZXIiLCJkdXJhdGlvbiI6Mn0sInNvdXJjZVBhdGgiOiIvY29tbWFuZHMvMSIsInRhcmdldCI6eyJlYXN0IjowLCJub3J0aCI6MCwidXAiOjMsImhlYWRpbmciOjB9LCJzcGVlZHMiOnsiaG9yaXpvbnRhbCI6Mi41LCJ2ZXJ0aWNhbCI6MS4yLCJ5YXciOjYwfX0seyJjb21tYW5kIjp7ImFjdGlvbiI6ImxhbmQifSwic291cmNlUGF0aCI6Ii9jb21tYW5kcy8yIiwidGFyZ2V0Ijp7ImVhc3QiOjAsIm5vcnRoIjowLCJ1cCI6MCwiaGVhZGluZyI6MH0sInNwZWVkcyI6eyJob3Jpem9udGFsIjoyLjUsInZlcnRpY2FsIjoxLjIsInlhdyI6NjB9fV0sImVzdGltYXRlZFNlY29uZHMiOjE3LjIwMDAwMDAwMDAwMDAwMywiY29tbWFuZENvdW50IjozLCJsaW1pdHMiOnsicmFkaXVzIjo1MCwibWF4QWx0aXR1ZGUiOjIwLCJtYXhTcGVlZCI6NSwiYXR0aXR1ZGVNYXhTcGVlZCI6NSwidmVydGljYWxTcGVlZCI6MiwieWF3U3BlZWQiOjkwLCJhY2NlbGVyYXRpb24iOjMsIm1heENvbW1hbmRzIjoxNSwibWF4UmVwZWF0Ijo0LCJtYXhSZXBlYXREZXB0aCI6MiwibWF4U291cmNlQnl0ZXMiOjIwMDAwLCJtYXhEdXJhdGlvbiI6MTgwLCJjb21tYW5kVGltZW91dCI6NjAsIm1heEhvdmVyIjozMCwiZGVmYXVsdFNwZWVkIjoyLjUsImRlZmF1bHRWZXJ0aWNhbFNwZWVkIjoxLjIsImRlZmF1bHRZYXdTcGVlZCI6NjAsInBvc2l0aW9uVG9sZXJhbmNlIjowLjI1LCJhbHRpdHVkZVRvbGVyYW5jZSI6MC4xNSwiaGVhZGluZ1RvbGVyYW5jZSI6MSwidmVsb2NpdHlUb2xlcmFuY2UiOjAuMTgsInlhd1JhdGVUb2xlcmFuY2UiOjMsInNldHRsZVRpbWUiOjAuNCwiYm91bmRhcnlJbnNldCI6MC4xLCJtaW5BbHRpdHVkZSI6MC41LCJtYXhKc29uTm9kZXMiOjUwMCwibWF4SnNvbkRlcHRoIjoxMiwibWF4TmFtZUxlbmd0aCI6ODAsIm1heFR1cm5BbmdsZSI6MzYwLCJtYXhXYXlwb2ludHMiOjEwLCJydGxBbHRpdHVkZSI6NSwicnRsQXBwcm9hY2hBbHRpdHVkZSI6MiwicnRsSG92ZXJEdXJhdGlvbiI6MSwibWF4R3BzUHJvamVjdGlvbkRpc3RhbmNlIjoxMDAwLCJtYXhQYXJhbGxlbENvbW1hbmRzIjo0LCJwYXJhbGxlbE1pbkR1cmF0aW9uIjowLjUsInRyYWplY3RvcnlNYXhMYWciOjEsInRyYWplY3RvcnlNYXhIZWFkaW5nTGFnIjoyMH19"
PLAN_SHA256 = "e189f95d8fa0489f1d0d579b2e8bf0352cfcfc2bfd707724b0ff2b5c614ae40d"

if __name__ == "__main__":
    main()
