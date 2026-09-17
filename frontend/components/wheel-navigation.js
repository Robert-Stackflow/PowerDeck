// Respond on the leading edge, then limit repeat rate without locking a gesture.
export function wheelNavigation(step, now = () => performance.now()) {
  let last = -Infinity,
    navigated = -Infinity,
    sum = 0,
    direction = 0;
  return (event) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return false;
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
    if (!delta) return false;
    const time = now(),
      sign = Math.sign(delta),
      reversed = direction && sign !== direction;
    const discrete =
      event.deltaMode !== 0 ||
      (Number.isInteger(delta) && Math.abs(delta) >= 80);
    if (time - last > 140 || reversed) sum = 0;
    last = time;
    direction = sign;
    const interval = reversed ? 70 : discrete ? 100 : 220;
    if (time - navigated < interval) return true;
    sum += delta;
    if (Math.abs(sum) >= 28) {
      sum = 0;
      navigated = time;
      step(sign);
    }
    return true;
  };
}
