import * as THREE from 'three';
/** Small desktop-only view sharing the main renderer. North stays at screen top. */
export class OverheadPreview {
  readonly canvas=document.createElement('canvas');
  readonly camera=new THREE.OrthographicCamera(-4,4,2.25,-2.25,.1,100);
  private target:THREE.WebGLRenderTarget|null=null;
  private context:CanvasRenderingContext2D;
  private pixels=new Uint8Array(320*180*4);
  private image:ImageData;
  private last=-Infinity;
  enabled=false;
  constructor(private renderer:THREE.WebGLRenderer,private scene:THREE.Scene){
    this.canvas.width=320;this.canvas.height=180;this.canvas.setAttribute('aria-label','無人機正上方即時俯視畫面');
    const context=this.canvas.getContext('2d',{alpha:false});if(!context)throw new Error('無法建立俯視預覽');this.context=context;this.image=context.createImageData(320,180);
    this.camera.up.set(0,0,-1);this.camera.layers.enable(1);
  }
  update(position:THREE.Vector3,now:number){
    if(!this.enabled||now-this.last<1000/12)return;
    this.camera.position.set(position.x,position.y+18,position.z);this.camera.lookAt(position);this.camera.updateMatrixWorld();
    this.target??=new THREE.WebGLRenderTarget(320,180,{depthBuffer:true});this.target.texture.colorSpace=THREE.SRGBColorSpace;
    const previous=this.renderer.getRenderTarget();
    try{this.target.viewport.set(0,0,320,180);this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.readRenderTargetPixels(this.target,0,0,320,180,this.pixels);}
    finally{this.renderer.setRenderTarget(previous);}
    for(let y=0;y<180;y++)this.image.data.set(this.pixels.subarray((179-y)*1280,(180-y)*1280),y*1280);
    this.context.putImageData(this.image,0,0);this.last=now;
  }
  setEnabled(value:boolean){this.enabled=value;if(!value){this.target?.dispose();this.target=null;}else this.last=-Infinity;}
  dispose(){this.setEnabled(false);this.canvas.remove();}
}
