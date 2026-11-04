/** Player-visible thumbnails only. Never persists Ground Truth or target coordinates. */
export class PhotoAlbum {
  private listeners=new Set<()=>void>();
  private protectedIds=new Set<string>();
  warning='';
  protect(ids:Iterable<string>){this.protectedIds=new Set(ids);}
  private warn(){this.warning='照片縮圖無法永久儲存；本次仍可評分與下載，重新整理後縮圖可能遺失。';for(const listener of this.listeners)listener();}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private memory=new Map<string,Blob>();private database:Promise<IDBDatabase|null>|null=null;
  private db(){return this.database??=new Promise(resolve=>{if(typeof indexedDB==='undefined'){resolve(null);return;}try{const request=indexedDB.open('ai-drone-lab-photo-album',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);}catch{resolve(null);}});}
  async put(id:string,image:Blob){
    let thumbnail=image;
    try{const bitmap=await createImageBitmap(image);try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=Math.round(320*bitmap.height/bitmap.width);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);thumbnail=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b??image),'image/jpeg',.8));}finally{bitmap.close();}}catch{/* Keep original in-memory if thumbnail encoding is unavailable. */}
    this.memory.set(id,thumbnail);while(this.memory.size>32)this.memory.delete(this.memory.keys().next().value!);for(const listener of this.listeners)listener();
    const db=await this.db();if(!db||thumbnail.size>500_000){this.warn();return false;}
    return new Promise<boolean>(resolve=>{try{const tx=db.transaction('photos','readwrite'),store=tx.objectStore('photos');store.put({id,image:thumbnail,saved:Date.now()});const all=store.getAll();all.onsuccess=()=>{const rows=all.result.sort((a,b)=>b.saved-a.saved),protectedRows=rows.filter(row=>this.protectedIds.has(row.id)).slice(0,300),keep=new Set(protectedRows.map(row=>row.id));for(const row of rows.filter(row=>!keep.has(row.id)).slice(0,100))keep.add(row.id);for(const row of rows)if(!keep.has(row.id))store.delete(row.id);};tx.oncomplete=()=>resolve(true);tx.onerror=()=>{this.warn();resolve(false);};tx.onabort=()=>{this.warn();resolve(false);};}catch{this.warn();resolve(false);}});
  }
  async get(id:string){if(this.memory.has(id))return this.memory.get(id)!;const db=await this.db();if(!db)return null;return new Promise<Blob|null>(resolve=>{try{const request=db.transaction('photos').objectStore('photos').get(id);request.onsuccess=()=>resolve(request.result?.image??null);request.onerror=()=>resolve(null);}catch{resolve(null);}});}
}
