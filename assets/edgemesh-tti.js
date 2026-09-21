// Immediate page-load interactivity estimate. No network/main-thread quiet window.
(() => {
  let measurement;

  function measure() {
    if (measurement) return measurement;
    const capture = window.__tti;
    if (!capture?.o) return Promise.resolve(null);

    measurement = new Promise((resolve) => {
      const finish = () => setTimeout(() => {
        // Let load handlers finish, then include observer records not yet delivered.
        const tasks = [...capture.e, ...capture.o.takeRecords()];
        capture.o.disconnect();
        const navigation = performance.getEntriesByType('navigation')[0];
        if (!navigation || !(navigation.domContentLoadedEventEnd > 0)) {
          resolve(null);
          return;
        }
        const paint = performance.getEntriesByName('first-contentful-paint')[0];
        let interactive = Math.max(navigation.domContentLoadedEventEnd, paint?.startTime || 0);
        for (const task of tasks) interactive = Math.max(interactive, task.startTime + task.duration);
        resolve(interactive - navigation.startTime);
      }, 0);

      if (document.readyState === 'complete') finish();
      else window.addEventListener('load', finish, { once: true });
    });
    return measurement;
  }

  window.edgemeshTti = { measure };
})();
