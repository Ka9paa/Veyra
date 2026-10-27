export type VeyraAssetRecord={
  id:string;
  url:string;
  alt:string;
  sectionId:string|null;
  role:string|null;
  aspectRatio:string|null;
  objectPosition:string|null;
  mobileObjectPosition:string|null;
};

export type VeyraAssetLibrary={
  version:1;
  assets:VeyraAssetRecord[];
  byId:Record<string,VeyraAssetRecord>;
  sections:Record<string,string[]>;
};

const attr=(s:string,n:string)=>{
  const e=n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const m=s.match(new RegExp(`\\s${e}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,"i"));
  return (m?.[1]??m?.[2]??"").trim();
};

const sectionBefore=(html:string,pos:number)=>{
  const re=/data-veyra-section\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  const source=html.slice(0,pos);
  let match:RegExpExecArray|null;
  let result:string|null=null;
  while((match=re.exec(source))) result=(match[1]??match[2]??"").trim()||null;
  return result;
};

export function buildAssetLibrary(html:string):VeyraAssetLibrary{
  const assets:VeyraAssetRecord[]=[];
  const re=/<img\b[^>]*>/gi;
  let match:RegExpExecArray|null;
  let index=0;

  while((match=re.exec(html))){
    const tag=match[0];
    const url=attr(tag,"src");
    if(!url) continue;

    assets.push({
      id:attr(tag,"data-veyra-id")||`veyra-asset-${++index}`,
      url,
      alt:attr(tag,"alt"),
      sectionId:attr(tag,"data-veyra-section")||sectionBefore(html,match.index),
      role:attr(tag,"data-veyra-asset-role")||null,
      aspectRatio:attr(tag,"data-veyra-aspect-ratio")||null,
      objectPosition:attr(tag,"data-veyra-object-position")||null,
      mobileObjectPosition:attr(tag,"data-veyra-mobile-object-position")||null
    });
  }

  const byId:Record<string,VeyraAssetRecord>={};
  const sections:Record<string,string[]>={};

  for(const asset of assets){
    let id=asset.id;
    let n=2;
    while(byId[id]) id=`${asset.id}-${n++}`;
    asset.id=id;
    byId[id]=asset;

    if(asset.sectionId){
      sections[asset.sectionId]??=[];
      sections[asset.sectionId].push(id);
    }
  }

  return {version:1,assets,byId,sections};
}

export const findAsset=(library:VeyraAssetLibrary,id:string)=>
  library.byId[id]??null;

export const assetsForSection=(library:VeyraAssetLibrary,id:string)=>
  (library.sections[id]??[]).map(x=>library.byId[x]).filter(Boolean);
