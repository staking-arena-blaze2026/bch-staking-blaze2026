import {afterEach,expect,it,vi} from 'vitest';
import {WssConnection} from '../../src/electrum-wss';
import {ElectrumTransportError} from '../../src/electrum-core';

class Socket {
 static OPEN=1;
 static CLOSING=2;
 static instances:Socket[]=[];
 readyState=0;
 onopen?:()=>void;
 onclose?:()=>void;
 onmessage?:(event:{data:string})=>void;
 send=vi.fn();
 close=vi.fn(()=>{this.readyState=Socket.CLOSING;});
 constructor(){Socket.instances.push(this);}
 open(){this.readyState=Socket.OPEN;this.onopen?.();}
}
afterEach(()=>{Socket.instances=[];vi.unstubAllGlobals();vi.useRealTimers();});

it('rejects interrupted Electrum RPCs and reconnects without sending on the old socket',async()=>{
 vi.stubGlobal('WebSocket',Socket);
 const connection=new WssConnection('wss://electrum.example',2000);
 const connected=connection.connect(),first=Socket.instances[0]!;
 first.open();await connected;
 const pending=connection.request('server.version');
 const staleClose=first.onclose!;
 first.readyState=3;staleClose();
 await expect(pending).rejects.toBeInstanceOf(ElectrumTransportError);
 await expect(connection.request('server.version')).rejects.toThrow('disconnected');
 expect(first.send).toHaveBeenCalledOnce();

 const reconnected=connection.connect(),second=Socket.instances[1]!;
 second.open();await reconnected;
 staleClose();
 const result=connection.request('server.version');
 const id=JSON.parse(second.send.mock.calls[0]![0]).id;
 second.onmessage?.({data:JSON.stringify({id,result:'available'})});
 await expect(result).resolves.toBe('available');
 connection.close();
 expect(second.close).toHaveBeenCalledOnce();
 expect(second.onclose).toBeNull();
});

it('settles an intentionally cancelled connection immediately and clears its timeout',async()=>{
 vi.useFakeTimers();vi.stubGlobal('WebSocket',Socket);
 const connection=new WssConnection('wss://electrum.example',2000);
 const connected=connection.connect();
 connection.close();
 await expect(connected).rejects.toThrow('session closed');
 expect(vi.getTimerCount()).toBe(0);
});
