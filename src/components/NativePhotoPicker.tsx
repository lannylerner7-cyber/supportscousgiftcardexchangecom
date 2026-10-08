import {useEffect,useState} from "react";
import {Capacitor} from "@capacitor/core";
import {Camera,CameraResultType,CameraSource} from "@capacitor/camera";
export function NativePhotoPicker({disabled,onPhoto,onError}:{disabled:boolean;onPhoto:(file:File)=>void;onError:(message:string)=>void}){
  const [native,setNative]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>setNative(Capacitor.isNativePlatform()),[]);
  async function choose(source:CameraSource){
    setBusy(true);
    try{
      const photo=await Camera.getPhoto({source,resultType:CameraResultType.Uri,quality:90,
        width:2400,height:2400,correctOrientation:true,saveToGallery:false,allowEditing:false});
      if(!photo.webPath)throw Error("The photo could not be opened. Please choose it again.");
      const response=await fetch(photo.webPath);
      if(!response.ok)throw Error("Could not read the selected photo.");
      const blob=await response.blob();
      if(photo.path?.startsWith("file:")){
        // Camera returns its temporary copy, not the member's photo-library asset.
        const {Filesystem}=await import("@capacitor/filesystem");
        await Filesystem.deleteFile({path:photo.path});
      }
      onPhoto(new File([blob],`card-${crypto.randomUUID()}.${photo.format}`,{type:blob.type||`image/${photo.format}`}));
    }catch(e){
      const message=(e as Error).message;
      if(!/cancel/i.test(message))onError(message||"Photo access failed. Check camera/photos permissions.");
    }finally{setBusy(false);}
  }
  if(!native)return null;
  return <div className="flex flex-wrap gap-3 text-primary text-sm">
    <button type="button" disabled={disabled||busy} onClick={()=>void choose(CameraSource.Camera)}>Take a card photo</button>
    <button type="button" disabled={disabled||busy} onClick={()=>void choose(CameraSource.Photos)}>Choose from photos</button>
    {busy&&<span role="status">Opening photo…</span>}
  </div>;
}
