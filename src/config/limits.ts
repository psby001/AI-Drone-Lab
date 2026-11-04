/** SI units. One source for model, scene, mission validation and execution. */
export const LIMITS = { radius: 50, maxAltitude: 20, maxSpeed: 5, attitudeMaxSpeed: 5, verticalSpeed: 2, yawSpeed: 90, acceleration: 3 } as const;
export const MISSION_LIMITS = {
  maxCommands: 15, maxRepeat: 4, maxRepeatDepth: 2, maxSourceBytes: 20000,
  maxDuration: 180, commandTimeout: 60, maxHover: 30,
  defaultSpeed: 2.5, defaultVerticalSpeed: 1.2, defaultYawSpeed: 60,
  positionTolerance: 0.25, altitudeTolerance: 0.15, headingTolerance: 1,
  velocityTolerance: 0.18, yawRateTolerance: 3, settleTime: 0.4,
  boundaryInset: 0.1,
  minAltitude: 0.5, maxJsonNodes: 500, maxJsonDepth: 12, maxNameLength: 80, maxTurnAngle: 360,
  maxWaypoints: 10, rtlAltitude: 5, rtlApproachAltitude: 2, rtlHoverDuration: 1,
  maxGpsProjectionDistance: 1000,
  maxParallelCommands:4, parallelMinDuration:0.5, trajectoryMaxLag:1, trajectoryMaxHeadingLag:20,
} as const;

/** Physical scene capacity; JSON/AI mission limits remain in LIMITS. */
export const SCENE_LIMITS = { maxRadius: 60, maxAltitude: 50 } as const;
