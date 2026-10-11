const port=Number(process.env.FRONTEND_UI_PORT??'4173');
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid client preview port');
export const APP_PORT=port;
export const APP_ORIGIN=new URL(`http://127.0.0.1:${port}`).origin;
