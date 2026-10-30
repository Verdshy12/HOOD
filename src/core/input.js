
 // src/core/input.js
 // Keyboard + touch + gamepad + tilt -> one shared controls object.
 // Vehicle physics never reads raw input devices.

 const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
 const lerp = (a, b, t) => a + (b - a) * t;

 export function smoothSteer(current, target, dt) {
   const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
   const rate = target === 0 ? 7 : 3.2;
   const difference = target - current;
   const maxStep = rate * safeDt;

   return Math.abs(difference) <= maxStep
   ? target
   : current + Math.sign(difference) * maxStep;
 }

 export function createInput({ onKey = () => {}, buttons = {} } = {}) {
   const keys = new Set();

   const ui = {
     turbo: false,
     drift: false,
     throttle: false,
     brake: false,
     left: false,
     right: false,
   };

   const state = {
     throttle: 0,
     brake: 0,
     steer: 0,
     handbrake: false,
     nitro: false,
   };

   let tiltSteer = 0;
   let tiltBaseline = null;
   let tiltActive = false;
   let orientationListening = false;
  let enabled = true;

   const down = (...values) => values.some((key) => keys.has(key));

   const resetControls = () => {
     keys.clear();

     for (const flag of Object.keys(ui)) {
       ui[flag] = false;
     }

     document.querySelectorAll(".drive-hold.on").forEach((element) => {
       element.classList.remove("on");
     });

     Object.assign(state, {
       throttle: 0,
       brake: 0,
       steer: 0,
       handbrake: false,
       nitro: false,
     });
   };

   const normaliseAngle = (degrees) =>
   ((degrees + 540) % 360) - 180;

   const readTilt = (event) => {
     const screenAngle =
     ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;

     if (screenAngle === 90) return event.beta;
     if (screenAngle === 270) return -event.beta;
     if (screenAngle === 180) return -event.gamma;

     return event.gamma;
   };

   const onOrientation = (event) => {
     if (!tiltActive) return;

     const value = readTilt(event);
     if (!Number.isFinite(value)) return;

     if (tiltBaseline === null) {
       tiltBaseline = value;
       return;
     }

     const delta = normaliseAngle(value - tiltBaseline);
     tiltSteer = Math.abs(delta) < 2 ? 0 : clamp(delta / 24, -1, 1);
   };

   const enableTiltSteering = async () => {
     const Orientation = window.DeviceOrientationEvent;

     if (!Orientation) {
       document.body.classList.add("tilt-unavailable");
       return false;
     }

     try {
       if (
         typeof Orientation.requestPermission === "function" &&
         (await Orientation.requestPermission()) !== "granted"
       ) {
         document.body.classList.add("tilt-unavailable");
         return false;
       }
     } catch {
       document.body.classList.add("tilt-unavailable");
       return false;
     }

     if (!orientationListening) {
       window.addEventListener("deviceorientation", onOrientation);
       orientationListening = true;
     }

     tiltBaseline = null;
     tiltSteer = 0;
     tiltActive = true;

     document.body.classList.remove("tilt-unavailable");
     document.body.classList.add("tilt-ready");

     return true;
   };

   const onKeyDown = (event) => {
     const key = event.key.toLowerCase();

     if (
       ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)
     ) {
       event.preventDefault();
     }

     if (!enabled) return;

     if (!event.repeat) {
       onKey(key);
     }

     keys.add(key);
   };

   const onKeyUp = (event) => {
     keys.delete(event.key.toLowerCase());
   };

   window.addEventListener("keydown", onKeyDown);
   window.addEventListener("keyup", onKeyUp);
   window.addEventListener("blur", resetControls);

   document.addEventListener("visibilitychange", () => {
     if (document.hidden) resetControls();
   });

     window.addEventListener("orientationchange", () => {
       resetControls();
       tiltBaseline = null;
       tiltSteer = 0;
     });

     const touchButtons = [
       ["turboBtn", "turbo"],
       ["driftBtn", "drift"],
       ["throttleBtn", "throttle"],
       ["brakeBtn", "brake"],
       ["steerLeftBtn", "left"],
       ["steerRightBtn", "right"],
     ];

     for (const [id, flag] of touchButtons) {
       const element = document.getElementById(id);
       if (!element) continue;

       element.classList.add("drive-hold");

       element.addEventListener("contextmenu", (event) => {
         event.preventDefault();
       });

       element.addEventListener("pointerdown", (event) => {
         event.preventDefault();
         if (!enabled) return;

         ui[flag] = true;
         element.classList.add("on");

         try {
           element.setPointerCapture(event.pointerId);
         } catch {
           // Pointer capture may be unavailable on some devices.
         }
       });

       const release = () => {
         ui[flag] = false;
         element.classList.remove("on");
       };

       for (const eventName of [
         "pointerup",
         "pointercancel",
         "lostpointercapture",
       ]) {
         element.addEventListener(eventName, release);
       }
     }

     return {
       // Call when a driving session starts or inputs need resetting.
       clear() {
         resetControls();
         tiltBaseline = null;
         tiltSteer = 0;
       },

       setEnabled(value) {
         enabled = !!value;
         if (!enabled) resetControls();
       },

       // Call once per rendered frame. Returns the shared controls object.
       poll(dt) {
         if (!enabled) return state;
         const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);

         const gamepads = navigator.getGamepads?.() ?? [];
         const pad = Array.from(gamepads).find((gamepad) => gamepad?.connected);

         const digitalSteer =
         (down("arrowright", "d") || ui.right ? 1 : 0) -
         (down("arrowleft", "a") || ui.left ? 1 : 0);

         let steerTarget =
         digitalSteer !== 0 ? digitalSteer : tiltActive ? tiltSteer : 0;

         let gas = down("arrowup", "w") || ui.throttle ? 1 : 0;
         let brake = down("arrowdown", "s") || ui.brake ? 1 : 0;
         let handbrake = down(" ") || ui.drift;
         let nitro = down("shift", "n") || ui.turbo;

         if (pad) {
           const rawAxis = pad.axes?.[0] ?? 0;
           const deadzone = 0.12;

           const axis =
           Math.abs(rawAxis) > deadzone
           ? Math.sign(rawAxis) *
           ((Math.abs(rawAxis) - deadzone) / (1 - deadzone))
           : 0;

           // Only let the stick override digital/tilt steering when moved.
           if (axis !== 0) {
             steerTarget = clamp(axis, -1, 1);
           }

           gas = Math.max(gas, pad.buttons?.[7]?.value ?? 0);
           brake = Math.max(brake, pad.buttons?.[6]?.value ?? 0);
           handbrake ||= !!pad.buttons?.[0]?.pressed;
           nitro ||= !!pad.buttons?.[5]?.pressed;
         }

         // Smooth analog input with a time-based response.
         if (pad && Math.abs(pad.axes?.[0] ?? 0) > 0.12) {
           const blend = 1 - Math.exp(-14 * safeDt);
           state.steer = lerp(state.steer, steerTarget, blend);
         } else {
           state.steer = smoothSteer(state.steer, steerTarget, safeDt);
         }

         Object.assign(state, {
           throttle: clamp(gas, 0, 1),
                       brake: clamp(brake, 0, 1),
                       handbrake,
                       nitro,
         });

         return state;
       },

       enableTiltSteering,
     };
 }
