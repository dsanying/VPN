const { app } = require('electron');
console.log('App is:', app);
if (app) {
  app.whenReady().then(() => {
    console.log('Ready!');
    app.quit();
  });
} else {
  console.log('App was undefined!');
  process.exit(1);
}
