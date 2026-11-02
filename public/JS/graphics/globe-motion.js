const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Rotation directe pendant le geste, puis vitesse amortie après le relâchement. */
export function createGlobeMotion(rotation, settings) {
  let dragging = false,
    velocityX = 0,
    velocityY = 0,
    lastTime = 0;
  const active = () => Math.hypot(velocityX, velocityY) >= settings.minSpeed;
  function stop() {
    dragging = false;
    velocityX = velocityY = 0;
  }
  function begin(time = performance.now()) {
    stop();
    dragging = true;
    lastTime = time;
  }
  function drag(dx, dy, time = performance.now()) {
    if (!dragging) begin(time);
    const seconds = clamp((time - lastTime) / 1000, 1 / 240, 0.12);
    const x = dx * settings.sensitivityX,
      y = -dy * settings.sensitivityY;
    const previousY = rotation[1];
    rotation[0] += x;
    rotation[1] = clamp(previousY + y, -settings.latitudeLimit, settings.latitudeLimit);
    const weight = 1 - Math.exp(-seconds / settings.smoothing);
    velocityX += (x / seconds - velocityX) * weight;
    velocityY += ((rotation[1] - previousY) / seconds - velocityY) * weight;
    const speed = Math.hypot(velocityX, velocityY);
    if (speed > settings.maxSpeed) {
      velocityX *= settings.maxSpeed / speed;
      velocityY *= settings.maxSpeed / speed;
    }
    if (
      (rotation[1] === settings.latitudeLimit && velocityY > 0) ||
      (rotation[1] === -settings.latitudeLimit && velocityY < 0)
    )
      velocityY = 0;
    lastTime = time;
  }
  function end(time = performance.now()) {
    dragging = false;
    if (time - lastTime > settings.releaseDelay || !active()) velocityX = velocityY = 0;
  }
  function step(seconds) {
    if (dragging || !active() || seconds <= 0) return false;
    // Intégrale exacte d’un amortissement exponentiel : indépendante du nombre de frames.
    const decay = Math.exp(-settings.friction * seconds),
      distance = (1 - decay) / settings.friction;
    rotation[0] += velocityX * distance;
    const targetY = rotation[1] + velocityY * distance;
    rotation[1] = clamp(targetY, -settings.latitudeLimit, settings.latitudeLimit);
    velocityX *= decay;
    velocityY *= decay;
    if (targetY !== rotation[1]) velocityY = 0;
    if (!active()) velocityX = velocityY = 0;
    return active();
  }
  return {
    begin,
    drag,
    end,
    step,
    stop,
    getSnapshot: () => ({ dragging, active: !dragging && active(), velocityX, velocityY }),
  };
}
