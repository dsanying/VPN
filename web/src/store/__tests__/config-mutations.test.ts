const mockSave=jest.fn();let mockConfig:Record<string,unknown>|null={servers:[],first:false,second:false};
jest.mock('../app-store',()=>({useAppStore:{getState:()=>({config:mockConfig,saveConfig:mockSave})}}));
import {patchConfig} from '../config-mutations';
beforeEach(()=>{mockConfig={servers:[],first:false,second:false};mockSave.mockReset().mockImplementation(async value=>{await Promise.resolve();mockConfig=value;});});
it('连续设置基于上一笔提交后的配置，不丢掉其他开关',async()=>{const first=patchConfig(c=>({...c,first:true}));const second=patchConfig(c=>({...c,second:true}));await Promise.all([first,second]);expect(mockConfig).toMatchObject({first:true,second:true});});
it('一次写入失败不乐观改变配置，也不阻塞后续有效写入',async()=>{mockSave.mockRejectedValueOnce(new Error('Rejected'));await expect(patchConfig(c=>({...c,first:true}))).rejects.toThrow('Rejected');await patchConfig(c=>({...c,second:true}));expect(mockConfig).toMatchObject({first:false,second:true});});
