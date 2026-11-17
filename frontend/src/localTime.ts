const formatters=new Map<string,Intl.DateTimeFormat>();
export const browserTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
export function localTimestamp(seconds:number,timeZone=browserTimezone()):string {
 if(!Number.isFinite(seconds))return 'Unavailable';
 let formatter=formatters.get(timeZone);
 if(!formatter){formatter=new Intl.DateTimeFormat(undefined,{timeZone,year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'});formatters.set(timeZone,formatter);}
 return formatter.format(new Date(seconds*1000));
}
export function localDateTimeInput(milliseconds:number):string {
 const d=new Date(milliseconds),pad=(n:number)=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
/** Native datetime-local parsing uses browser timezone and its DST rules. Reject nonexistent spring-forward times. */
export function parseLocalDateTime(value:string):number {
 const normalized=value.length===16?value+':00':value;
 const milliseconds=Date.parse(normalized);
 if(!Number.isFinite(milliseconds)||localDateTimeInput(milliseconds)!==normalized)throw Error('Enter a valid local schedule start (this time may not exist during a daylight-saving change)');
 return milliseconds/1000;
}
