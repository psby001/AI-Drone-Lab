"""Local tests only. Fake vehicle tests are NOT SITL flight verification."""
import contextlib
import copy
import importlib.metadata
import inspect
import io
import json
import math
import base64
import hashlib
import sys
import runpy
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch
import drone_controller as runtime


if '--samples' in sys.argv:
    for case in json.load(sys.stdin):
        t = case['trajectory']
        for i, expected in enumerate(case['samples']):
            p, v = runtime.sample(t, t['duration']*i/20)
            for key in p:
                assert abs(p[key]-expected['position'][key]) < 1e-9
            for key in v:
                assert abs(v[key]-expected['velocity'][key]) < 1e-9
    print('Trajectory equivalence passed')
    sys.exit(0)

from dronekit import Vehicle, VehicleMode, connect
from pymavlink import mavutil
print('Python', sys.version.split()[0], 'dronekit', importlib.metadata.version('dronekit'),
      'pymavlink', importlib.metadata.version('pymavlink'))
assert 'heartbeat_timeout' in inspect.signature(connect).parameters
for api in ('simple_takeoff', 'send_mavlink', 'close', 'groundspeed', 'is_armable', 'mode', 'armed', 'last_heartbeat'):
    assert hasattr(Vehicle, api), api


class Clock:
    now = 100.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeVehicle:
    """Uses actual pymavlink encoder, with idealized instantaneous tracking."""
    def __init__(self, home=None, local_after_arm=False, never_local=False):
        self.local_after_arm, self.never_local = local_after_arm, never_local
        home = home or dict(latitude=25.033, longitude=121.5654)
        self.location = NS(local_frame=NS(north=100.0, east=200.0, down=-7.0),
                           global_relative_frame=NS(alt=5.0, lat=home['latitude'], lon=home['longitude']))
        if local_after_arm or never_local:
            self.location.local_frame = NS(north=None, east=None, down=None)
        self.message_factory = mavutil.mavlink.MAVLink(None)
        self._vehicle_type = mavutil.mavlink.MAV_TYPE_QUADROTOR
        self._autopilot_type = mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA
        self.version = 'FAKE VEHICLE (not ArduPilot SITL)'
        self.is_armable, self.armed, self.heading = True, False, 0
        self.gps_0 = NS(fix_type=3)
        self.parameters = {'WPNAV_SPEED_UP': 250, 'SIM_SPEEDUP': 1}
        self.velocity = [0, 0, 0]
        self.last_heartbeat = 0
        self._mode = VehicleMode('GUIDED')
        self.messages = []
        self.yaw_messages = []
        self.takeoff_count = 0
        self.mode_messages = []
        self.ignore_modes = False
        self.ignore_position_yaw = False
        self.closed = False

    def close(self):
        self.closed = True

    @property
    def armed(self):
        return self._armed

    @armed.setter
    def armed(self, value):
        self._armed = value
        if value and self.local_after_arm and not self.never_local:
            self.location.local_frame = NS(north=100.0, east=200.0, down=-7.0)

    @property
    def mode(self):
        return self._mode

    @mode.setter
    def mode(self, value):
        self._mode = value
        if value.name == 'LAND':
            self.location.local_frame.down = -7
            self.location.global_relative_frame.alt = 5
            self.armed = False

    def simple_takeoff(self, altitude):
        self.takeoff_count += 1
        self.location.local_frame.down = -7-(altitude-5)
        self.location.global_relative_frame.alt = altitude

    def send_mavlink(self, message):
        if message.get_type() == 'SET_MODE':
            assert message.base_mode == mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
            self.mode_messages.append(message)
            if self.ignore_modes:
                return
            self.mode = VehicleMode({4: 'GUIDED', 9: 'LAND'}[message.custom_mode])
            return
        if message.get_type() == 'COMMAND_LONG':
            assert message.command == mavutil.mavlink.MAV_CMD_CONDITION_YAW
            assert message.param4 == 0  # Absolute heading.
            self.yaw_messages.append(message)
            self.heading = message.param1
            return
        # Fail if the real generated message's axes/mask/frame are inconsistent.
        assert message.get_type() == 'SET_POSITION_TARGET_LOCAL_NED'
        assert message.coordinate_frame == mavutil.mavlink.MAV_FRAME_LOCAL_NED
        assert message.type_mask == 2496
        self.messages.append(message)
        self.location.local_frame = NS(north=message.x, east=message.y, down=message.z)
        self.location.global_relative_frame.alt = 5+(-7-message.z)
        if not self.ignore_position_yaw:
            self.heading = math.degrees(message.yaw) % 360


plans = json.load(sys.stdin)
for plan in plans:
    runtime.check_plan(plan)
    vehicle = FakeVehicle(plan['mission'].get('home'))
    clock = Clock()
    with patch.object(runtime, 'time', clock), contextlib.redirect_stdout(io.StringIO()):
        controller = runtime.DroneController(vehicle, plan, VehicleMode, mavutil.mavlink)
        controller.prepare()
        for i in range(len(plan['steps'])):
            controller.execute_step(i)
        assert not vehicle.armed
        assert vehicle.mode.name == 'LAND'
        assert abs(controller.pose()['up']) < 1e-9
        assert vehicle.messages
        for message in vehicle.messages:
            assert math.hypot(message.vx, message.vy) <= 5+1e-8
            assert abs(message.vz) <= 2+1e-8
        # A nonzero EKF launch origin must not alter the requested ENU displacement.
        controller.send_target(dict(east=2, north=3, up=4, heading=90), dict(east=1, north=2, up=0.5))
        message = vehicle.messages[-1]
        assert (message.x, message.y, message.z) == (103, 202, -11)
        assert (message.vx, message.vy, message.vz) == (2, 1, -0.5)
        assert abs(message.yaw-math.pi/2) < 1e-9

        vehicle.armed = True
        vehicle._mode = VehicleMode('LOITER')
        try:
            controller.guard()
            raise AssertionError('Mode change must fail')
        except RuntimeError:
            pass

        vehicle.last_heartbeat = 0
        vehicle._mode = VehicleMode('LAND')
        vehicle.location.local_frame = NS(north=controller.launch['north'], east=controller.launch['east'], down=controller.launch['down']+0.8)
        controller.guard(landing=True)  # Near-ground EKF drift must not interrupt LAND.
        vehicle.location.local_frame.east += 51
        try:
            controller.guard(landing=True)
            raise AssertionError('Landing must still enforce the horizontal fence')
        except RuntimeError:
            pass
        vehicle._mode = VehicleMode('GUIDED')
        vehicle.last_heartbeat = 4
        try:
            controller.guard()
            raise AssertionError('Heartbeat loss must fail')
        except RuntimeError:
            pass

# An already armed aircraft must not be claimed by the controller.
v = FakeVehicle()
v.armed = True
c = runtime.DroneController(v, plans[0], VehicleMode, mavutil.mavlink)
try:
    c.prepare()
    raise AssertionError('Already armed must fail')
except RuntimeError:
    assert not c.owns_flight
bad = copy.deepcopy(plans[0])
bad['steps'][0]['target']['up'] = 999
try:
    runtime.check_plan(bad)
    raise AssertionError('Invalid target must fail')
except ValueError:
    pass

# Exercise the actual entry point with a patched connection; never open sockets.
raw = json.dumps(plans[0]).encode()
runtime.PLAN_B64 = base64.b64encode(raw)
runtime.PLAN_SHA256 = hashlib.sha256(raw).hexdigest()
runtime.run_mission = lambda commands: [commands._command(**step['command']) for step in plans[0]['steps']]
for scenario in ('success', 'guided-from-stabilize', 'mode-timeout', 'local-after-arm', 'no-local-after-arm', 'heading-341', 'legacy-sitl', 'missing-sitl', 'partial-sitl', 'already-armed', 'tracking-error', 'manual-takeover'):
    v = FakeVehicle(local_after_arm=scenario=='local-after-arm', never_local=scenario=='no-local-after-arm')
    if scenario == 'heading-341':
        v.heading = 341
        v.ignore_position_yaw = True
    if scenario in ('guided-from-stabilize', 'mode-timeout'):
        v._mode = VehicleMode('STABILIZE')
        v.ignore_modes = scenario == 'mode-timeout'
    if scenario in ('legacy-sitl', 'missing-sitl', 'partial-sitl'):
        del v.parameters['SIM_SPEEDUP']
        if scenario == 'legacy-sitl':
            v.parameters.update(SIM_WIND_SPD=0, SIM_WIND_DIR=180, SIM_WIND_TURB=0)
        elif scenario == 'partial-sitl':
            v.parameters.update(SIM_WIND_SPD=0, SIM_WIND_DIR=180)
    if scenario == 'already-armed':
        v.armed = True
    elif scenario == 'tracking-error':
        original_send = v.send_mavlink
        def fail_send(message):
            if message.get_type() == 'SET_POSITION_TARGET_LOCAL_NED':
                raise RuntimeError('injected position send failure')
            original_send(message)
        v.send_mavlink = fail_send
    elif scenario == 'manual-takeover':
        original_send = v.send_mavlink
        def takeover(message):
            original_send(message)
            v._mode = VehicleMode('LOITER')
        v.send_mavlink = takeover
    with patch('dronekit.connect', return_value=v), patch.object(runtime, 'time', Clock()), \
            patch.object(sys, 'argv', ['mission.py', '--execute-sitl']), contextlib.redirect_stdout(io.StringIO()):
        try:
            runtime.main()
            assert scenario in ('success', 'guided-from-stabilize', 'legacy-sitl', 'local-after-arm', 'heading-341')
        except (RuntimeError, TimeoutError):
            assert scenario not in ('success', 'guided-from-stabilize', 'legacy-sitl', 'local-after-arm', 'heading-341')
    assert v.closed
    assert v.parameters['WPNAV_SPEED_UP'] == 250
    if scenario == 'mode-timeout':
        assert not v.armed and v.mode.name == 'STABILIZE' and v.takeoff_count == 0
        assert len(v.mode_messages) >= 2
    elif scenario in ('missing-sitl', 'partial-sitl'):
        assert not v.armed and v.mode.name == 'GUIDED' and not v.messages
    elif scenario == 'already-armed':
        assert v.armed and v.mode.name == 'GUIDED'  # Do not land someone else's flight.
    elif scenario == 'manual-takeover':
        assert v.armed and v.mode.name == 'LOITER'  # Do not override the operator.
    else:
        assert not v.armed and v.mode.name == 'LAND'
    if scenario == 'no-local-after-arm':
        assert v.takeoff_count == 0 and not v.messages
    if scenario == 'heading-341':
        assert v.yaw_messages and v.yaw_messages[0].param1 == 0
    if scenario == 'guided-from-stabilize':
        assert [m.custom_mode for m in v.mode_messages] == [4, 9]
for file in Path('public/dronekit').glob('*.py'):
    script = runpy.run_path(str(file))
    plan = json.loads(base64.b64decode(script['PLAN_B64']))
    vehicle = FakeVehicle(plan['mission'].get('home'))
    with patch.object(runtime, 'time', Clock()), contextlib.redirect_stdout(io.StringIO()):
        controller = runtime.DroneController(vehicle, plan, VehicleMode, mavutil.mavlink)
        controller.prepare()
        commands = script['FlightCommands'](controller, plan)
        script['run_mission'](commands)
        commands.finish()
        assert not vehicle.armed
        assert commands.index == len(plan['steps'])
print('All presets: real MAVLink encoding / named teaching commands / fake vehicle / safety tests passed (not SITL)')
