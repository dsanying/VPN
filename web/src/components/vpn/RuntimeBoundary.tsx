import { Component, type ReactNode } from 'react';
import { Button, Alert } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import i18n from '@/i18n';
export class RuntimeBoundary extends Component<{children:ReactNode},{error:Error|null}>{
 state:{error:Error|null}={error:null};
 static getDerivedStateFromError(error:Error){return {error};}
 render(){return this.state.error?<Alert type="error" title={i18n.t('errors.configNotLoaded')} description={this.state.error.message} action={<Button icon={<ReloadOutlined aria-hidden/>} onClick={()=>window.location.reload()}>{i18n.t('common.actions.retry')}</Button>}/>:this.props.children;}
}
