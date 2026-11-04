import * as THREE from 'three';
import type { TargetRegistry } from './TargetRegistry';
import type { ObjectAnnotation } from './types';
import { disposeSceneGroup } from '../challenges/scene';
export const DEBUG_LAYER=30;
export class GroundTruthDebugView {
  private group=new THREE.Group();private ids='';private boxes=new Map<string,THREE.Box3Helper>();private frustum:THREE.CameraHelper|null=null;private enabled=false;private annotations=new Map<string,ObjectAnnotation>();
  constructor(private scene:THREE.Scene,private registry:TargetRegistry,private camera:THREE.PerspectiveCamera){this.group.visible=false;scene.add(this.group);}
  setEnabled(enabled:boolean){this.enabled=enabled;this.group.visible=enabled;if(!enabled){disposeSceneGroup(this.group);this.boxes.clear();this.frustum=null;this.ids='';}else this.update();}
  setAnnotations(annotations:ObjectAnnotation[]){this.annotations=new Map(annotations.map(a=>[a.object_id,a]));}
  update(){if(!this.enabled)return;const targets=this.registry.getTargets(),ids=targets.map(t=>t.object_id).join('|');
    if(ids!==this.ids||!this.frustum){disposeSceneGroup(this.group);this.scene.add(this.group);this.group.visible=true;this.boxes.clear();for(const t of targets){const helper=new THREE.Box3Helper(new THREE.Box3(),0x46b57b);this.boxes.set(t.object_id,helper);this.group.add(helper);}this.frustum=new THREE.CameraHelper(this.camera);this.group.add(this.frustum);this.group.traverse(o=>o.layers.set(DEBUG_LAYER));this.ids=ids;}
    for(const t of targets){const box=this.boxes.get(t.object_id)!;box.box.setFromPoints(t.bounding_box_3d.world_corners_scene.map(p=>new THREE.Vector3(...p)));const annotation=this.annotations.get(t.object_id);(box.material as THREE.LineBasicMaterial).color.set(!annotation||annotation.is_valid_annotation&&!annotation.is_occluded?0x46b57b:annotation.visibility_ratio>.5?0xe2b541:0xe06455);}
    this.frustum?.update();
  }
  dispose(){disposeSceneGroup(this.group);this.boxes.clear();this.annotations.clear();}
}
