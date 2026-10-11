/** 更新窗口仅使用原有最小 preload，不暴露主窗口的配置或网络接口。 */
import {useEffect,useState} from 'react';
import {Button,ConfigProvider,Progress,Tag,Typography} from 'antd';
import {CloseOutlined,DownloadOutlined,ReloadOutlined} from '@ant-design/icons';
import {buildThemeConfig} from '../src/config/theme';
import '../src/design/tokens.css';
import './popup.css';
import type {UpdatePopupState,UpdatePopupAction} from '../../src/shared/types/update';
declare global{interface Window{flowzUpdatePopup?:{onState:(cb:(state:UpdatePopupState)=>void)=>()=>void;sendAction:(action:UpdatePopupAction)=>void}}}
export function Popup(){
 const [state,setState]=useState<UpdatePopupState>();
 useEffect(()=>window.flowzUpdatePopup?.onState(next=>{document.documentElement.dataset.theme=next.theme;setState(next);}),[]);
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&state&&state.phase!=='done')window.flowzUpdatePopup?.sendAction(state.phase==='remind'?'later':state.phase==='progress'?'cancel':'close');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[state]);
 if(!state)return null;const labels=state.labels;const send=(action:UpdatePopupAction)=>window.flowzUpdatePopup?.sendAction(action);
 const title=state.phase==='remind'?labels.remindTitle:state.phase==='progress'?labels.progressTitle:state.phase==='done'?labels.doneTitle:labels.errorTitle;
 return <ConfigProvider theme={buildThemeConfig(state.theme)}><div className="popup"><div className="popup-heading"><Typography.Title level={1}>{title}</Typography.Title><Tag>{state.version}</Tag>{state.phase!=='done'?<Button type="text" icon={<CloseOutlined aria-hidden/>} aria-label={state.phase==='progress'?labels.cancel:state.phase==='remind'?labels.later:labels.close} onClick={()=>send(state.phase==='progress'?'cancel':state.phase==='remind'?'later':'close')}/>:null}</div>
 {state.phase==='progress'||state.phase==='done'?<><Progress percent={Math.max(0,Math.min(100,Math.round(state.phase==='done'?100:state.percentage??0)))} size="small"/><Typography.Text>{state.phase==='done'?labels.installing:state.mirror?labels.tryingMirror:state.bytesText}</Typography.Text></>:null}
 {state.phase==='remind'?<><Typography.Text>{state.currentVersion?`${labels.currentPrefix} ${state.currentVersion}`:''}</Typography.Text><div className="popup-actions"><Button color={state.readyToInstall?'orange':'primary'} variant="solid" icon={state.readyToInstall?<ReloadOutlined aria-hidden/>:<DownloadOutlined aria-hidden/>} onClick={()=>send('update')}>{labels.update}</Button><Button onClick={()=>send('later')}>{labels.later}</Button></div><div className="popup-actions">{!state.readyToInstall?<Button type="link" onClick={()=>send('skip')}>{labels.skip}</Button>:null}<Button type="link" onClick={()=>send('viewLog')}>{labels.viewLog}</Button></div></>:null}
 {state.phase==='error'?<><Typography.Text type="danger">{state.errorText}</Typography.Text><div className="popup-actions"><Button type="primary" icon={<ReloadOutlined aria-hidden/>} onClick={()=>send('retry')}>{labels.retry}</Button><Button onClick={()=>send('manualDownload')}>{labels.manualDownload}</Button></div></>:null}
 </div></ConfigProvider>;
}
