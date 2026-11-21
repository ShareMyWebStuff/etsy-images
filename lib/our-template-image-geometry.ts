import type { ListingArtworkOrientation } from '@/lib/listing-print-crops';
import type { Point, TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import type { PrintableDownloadRatio } from '@/lib/printable-download-specs';
import type { OurTemplateImageDefinition, OurTemplateImageOpening, PaperPlacement, PaperPlacementKey } from '@/lib/our-template-image-types';
import { validateForegroundMask } from '@/lib/our-template-image-foreground-mask';

export const PAPER_RATIOS = [
  { key: 'iso-a1', label: 'ISO A', width: 1, height: Math.SQRT2 },
  { key: '2x3', label: '2:3', width: 2, height: 3 },
  { key: '3x4', label: '3:4', width: 3, height: 4 },
  { key: '4x5', label: '4:5', width: 4, height: 5 },
  { key: '5x7', label: '5:7', width: 5, height: 7 },
  { key: '11x14', label: '11:14', width: 11, height: 14 },
] as const;

export function placementKey(ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation): PaperPlacementKey {
  return `${ratio}:${orientation}`;
}

export function paperAspect(ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  const spec = PAPER_RATIOS.find((item) => item.key === ratio);
  if (!spec) throw new Error('Choose a supported paper ratio.');
  return orientation === 'landscape' ? spec.height / spec.width : spec.width / spec.height;
}

export function invertHomography(matrix: number[]) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error('The opening corners do not define a valid perspective.');
  return [(e*i-f*h)/determinant,(c*h-b*i)/determinant,(b*f-c*e)/determinant,
    (f*g-d*i)/determinant,(a*i-c*g)/determinant,(c*d-a*f)/determinant,
    (d*h-e*g)/determinant,(b*g-a*h)/determinant,(a*e-b*d)/determinant];
}

/** Unit rectangle to image homography; unlike a bounding box this preserves the frame plane. */
export function openingHomography(corners: TemplateOpeningCorners) {
  const {topLeft:p0,topRight:p1,bottomRight:p2,bottomLeft:p3} = corners;
  const dx1=p1.x-p2.x, dx2=p3.x-p2.x, dx3=p0.x-p1.x+p2.x-p3.x;
  const dy1=p1.y-p2.y, dy2=p3.y-p2.y, dy3=p0.y-p1.y+p2.y-p3.y;
  let g=0,h=0;
  if (Math.abs(dx3)>1e-10 || Math.abs(dy3)>1e-10) {
    const divisor=dx1*dy2-dx2*dy1;
    if (Math.abs(divisor)<1e-10) throw new Error('The opening corners do not define a valid perspective.');
    g=(dx3*dy2-dx2*dy3)/divisor;
    h=(dx1*dy3-dx3*dy1)/divisor;
  }
  return [p1.x-p0.x+g*p1.x,p3.x-p0.x+h*p3.x,p0.x,
    p1.y-p0.y+g*p1.y,p3.y-p0.y+h*p3.y,p0.y,g,h,1];
}

export function projectPoint(matrix: number[], point: Point): Point {
  const divisor=matrix[6]*point.x+matrix[7]*point.y+matrix[8];
  if (Math.abs(divisor)<1e-10) throw new Error('The paper extends beyond a valid perspective.');
  return {x:(matrix[0]*point.x+matrix[1]*point.y+matrix[2])/divisor,
    y:(matrix[3]*point.x+matrix[4]*point.y+matrix[5])/divisor};
}

export function estimateOpeningAspect(corners: TemplateOpeningCorners, width?: number, height?: number) {
  const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
  const horizontal=(distance(corners.topLeft,corners.topRight)+distance(corners.bottomLeft,corners.bottomRight))/2;
  const vertical=(distance(corners.topLeft,corners.bottomLeft)+distance(corners.topRight,corners.bottomRight))/2;
  if (horizontal<1 || vertical<1) throw new Error('The opening is too small.');
  // Recover a camera metric from the two orthogonal vanishing directions when
  // possible (centred principal point, square pixels). Affine/near frontal views
  // have vanishing points at infinity; rectified edge lengths are the fallback.
  if (width && height) {
    const matrix=openingHomography(corners), cx=width/2,cy=height/2;
    const ax=matrix[0]-cx*matrix[6], ay=matrix[3]-cy*matrix[6], az=matrix[6];
    const bx=matrix[1]-cx*matrix[7], by=matrix[4]-cy*matrix[7], bz=matrix[7];
    // Near-parallel edges do not constrain a focal length reliably: moving one
    // corner by a pixel can otherwise halve the inferred aspect. Require a
    // measurable perspective change on both axes before using that estimate.
    const minimumPerspective=Math.max(.02,4/Math.min(horizontal,vertical));
    if (Math.min(Math.abs(az),Math.abs(bz))>=minimumPerspective) {
      const focalSquared=-(ax*bx+ay*by)/(az*bz);
      if (focalSquared>Math.max(width,height)**2*0.01 && focalSquared<Math.max(width,height)**2*10000) {
        const aspect=Math.sqrt((ax*ax+ay*ay+focalSquared*az*az)/(bx*bx+by*by+focalSquared*bz*bz));
        if (aspect>0.1 && aspect<10) return aspect;
      }
    }
  }
  return horizontal/vertical;
}

export function suggestPaperRatio(corners: TemplateOpeningCorners, width?: number, height?: number) {
  const aspect=estimateOpeningAspect(corners,width,height);
  const options=PAPER_RATIOS.flatMap(({key:ratio})=>(['portrait','landscape'] as const).map((orientation)=>{
    const target=paperAspect(ratio,orientation);
    return {ratio,orientation,croppedFraction:1-Math.min(aspect/target,target/aspect)};
  }));
  return options.reduce((best,next)=>next.croppedFraction<best.croppedFraction?next:best);
}

export function paperPlacementHeight(placement: PaperPlacement, openingAspect: number, ratio: PrintableDownloadRatio, orientation: ListingArtworkOrientation) {
  return placement.width*openingAspect/paperAspect(ratio,orientation);
}

export function defaultPaperPlacement(openingAspect:number,ratio:PrintableDownloadRatio,orientation:ListingArtworkOrientation):PaperPlacement {
  const width=Math.max(1,paperAspect(ratio,orientation)/openingAspect);
  const height=width*openingAspect/paperAspect(ratio,orientation);
  return {x:(1-width)/2,y:(1-height)/2,width};
}

/** Every opening corner remains covered even after moving, resizing, or changing its geometry. */
export function constrainPaperPlacement(preferred:PaperPlacement,openingAspect:number,ratio:PrintableDownloadRatio,orientation:ListingArtworkOrientation):PaperPlacement {
  const minimum=defaultPaperPlacement(openingAspect,ratio,orientation);
  const width=Math.min(minimum.width*20,Math.max(minimum.width,Number.isFinite(preferred.width)?preferred.width:minimum.width));
  const height=width*openingAspect/paperAspect(ratio,orientation);
  return {x:Math.max(1-width,Math.min(0,Number.isFinite(preferred.x)?preferred.x:minimum.x)),
    y:Math.max(1-height,Math.min(0,Number.isFinite(preferred.y)?preferred.y:minimum.y)),width};
}

/** Keep the user's zoom and pan relative to the mount while correcting its corners. */
export function rebaseOpeningPlacements(opening:OurTemplateImageOpening,nextCorners:TemplateOpeningCorners,imageWidth:number,imageHeight:number):OurTemplateImageOpening['placements'] {
  const oldAspect=estimateOpeningAspect(opening.corners,imageWidth,imageHeight),newAspect=estimateOpeningAspect(nextCorners,imageWidth,imageHeight);
  const activeKey=placementKey(opening.ratio,opening.orientation);
  const saved={...opening.placements,[activeKey]:opening.placements[activeKey]??defaultPaperPlacement(oldAspect,opening.ratio,opening.orientation)};
  const fraction=(position:number,size:number)=>Math.abs(1-size)>1e-6?Math.max(0,Math.min(1,position/(1-size))):.5;
  return Object.fromEntries(Object.entries(saved).map(([key,preferred])=>{
    const [ratio,orientation]=key.split(':') as [PrintableDownloadRatio,ListingArtworkOrientation];
    const oldPlacement=constrainPaperPlacement(preferred,oldAspect,ratio,orientation),oldMinimum=defaultPaperPlacement(oldAspect,ratio,orientation);
    const nextMinimum=defaultPaperPlacement(newAspect,ratio,orientation),width=nextMinimum.width*(oldPlacement.width/oldMinimum.width);
    const height=paperPlacementHeight({x:0,y:0,width},newAspect,ratio,orientation);
    const oldHeight=paperPlacementHeight(oldPlacement,oldAspect,ratio,orientation);
    return [key,constrainPaperPlacement({width,x:fraction(oldPlacement.x,oldPlacement.width)*(1-width),y:fraction(oldPlacement.y,oldHeight)*(1-height)},newAspect,ratio,orientation)];
  })) as OurTemplateImageOpening['placements'];
}

export function paperPlacementCorners(corners:TemplateOpeningCorners,placement:PaperPlacement,openingAspect:number,ratio:PrintableDownloadRatio,orientation:ListingArtworkOrientation):TemplateOpeningCorners {
  const matrix=openingHomography(corners),height=paperPlacementHeight(placement,openingAspect,ratio,orientation);
  return {topLeft:projectPoint(matrix,{x:placement.x,y:placement.y}),
    topRight:projectPoint(matrix,{x:placement.x+placement.width,y:placement.y}),
    bottomRight:projectPoint(matrix,{x:placement.x+placement.width,y:placement.y+height}),
    bottomLeft:projectPoint(matrix,{x:placement.x,y:placement.y+height})};
}

export function validateOurTemplateImageDefinition(value:unknown,expectedWidth?:number,expectedHeight?:number):OurTemplateImageDefinition {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The scene configuration is invalid.');
  const record=value as Record<string,unknown>,width=Number(record.width),height=Number(record.height);
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||width>16000||height>16000||width*height>64000000)throw new Error('The scene dimensions are invalid (maximum 64 megapixels).');
  if(expectedWidth!==undefined&&width!==expectedWidth||expectedHeight!==undefined&&height!==expectedHeight)throw new Error('The opening coordinates do not match the original scene dimensions.');
  if(!['auto','opaque','paired'].includes(String(record.lightingMode)))throw new Error('Choose a valid scene lighting mode.');
  if(!Array.isArray(record.openings)||record.openings.length<1||record.openings.length>50)throw new Error('Configure between 1 and 50 picture openings.');
  const ids=new Set<string>();
  const openings=record.openings.map((value,index):OurTemplateImageOpening=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Opening ${index+1} is invalid.`);
    const opening=value as Record<string,unknown>,id=String(opening.id??'').trim(),name=String(opening.name??'').trim();
    if(!id||id.length>100||ids.has(id)||!name||name.length>100)throw new Error('Every opening needs a unique identifier and a name of at most 100 characters.');
    ids.add(id);
    const imageItemNumber=Number(opening.imageItemNumber);
    if(!Number.isInteger(imageItemNumber)||imageItemNumber<1||imageItemNumber>100)throw new Error('Choose an artwork item from 1 to 100.');
    if(!PAPER_RATIOS.some((ratio)=>ratio.key===opening.ratio)||!['portrait','landscape'].includes(String(opening.orientation)))throw new Error('Choose a supported paper ratio and orientation.');
    if(!opening.corners||typeof opening.corners!=='object')throw new Error('Select the four inner corners of each opening.');
    const suppliedCorners=opening.corners as Record<string,unknown>;
    const cornerNames=['topLeft','topRight','bottomRight','bottomLeft'] as const;
    const points=cornerNames.map((key)=>{
      const point=suppliedCorners[key] as Point|undefined;
      if(!point||!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0||point.x>=width||point.y>=height)throw new Error('Opening corners must use original image pixel coordinates inside the scene.');
      return {x:point.x,y:point.y};
    });
    const crosses=points.map((a,index)=>{const b=points[(index+1)%4],c=points[(index+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
    const area=Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%4].y-points[(i+1)%4].x*p.y,0))/2;
    if(crosses.some((cross)=>cross<=0)||area<9)throw new Error('Opening corners must form a convex area ordered top-left, top-right, bottom-right, bottom-left.');
    const corners=Object.fromEntries(cornerNames.map((key,index)=>[key,points[index]])) as TemplateOpeningCorners;
    const aspect=estimateOpeningAspect(corners,width,height),placements:OurTemplateImageOpening['placements']={};
    if(!opening.placements||typeof opening.placements!=='object'||Array.isArray(opening.placements))throw new Error('The saved paper placements are invalid.');
    for(const [key,value] of Object.entries(opening.placements)){
      const [ratio,orientation,...rest]=key.split(':');
      if(rest.length||!PAPER_RATIOS.some((item)=>item.key===ratio)||!['portrait','landscape'].includes(orientation))throw new Error('A saved paper placement has an unsupported ratio.');
      const p=value as PaperPlacement;
      if(!p||![p.x,p.y,p.width].every(Number.isFinite)||p.width<=0)throw new Error('A saved paper placement is invalid.');
      placements[key as PaperPlacementKey]=constrainPaperPlacement(p,aspect,ratio as PrintableDownloadRatio,orientation as ListingArtworkOrientation);
    }
    const ratio=opening.ratio as PrintableDownloadRatio,orientation=opening.orientation as ListingArtworkOrientation,key=placementKey(ratio,orientation);
    placements[key]??=defaultPaperPlacement(aspect,ratio,orientation);
    return {id,name,corners,imageItemNumber,ratio,orientation,placements};
  });
  const foregroundMask=record.foregroundMask===undefined?undefined:validateForegroundMask(record.foregroundMask,width,height);
  return {width,height,openings,lightingMode:record.lightingMode as OurTemplateImageDefinition['lightingMode'],
    ...(foregroundMask===undefined?{}:{foregroundMask})};
}

export type OpeningDetection = {corners:TemplateOpeningCorners;confidence:'high'|'low';method:'transparency'|'edges'|'manual'};

/** Click-seeded region segmentation, independent of colour markers or PNG alpha. */
export function detectOpeningAtPoint(rgba:Uint8Array,width:number,height:number,point:Point):OpeningDetection {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<4||height<4||rgba.length<width*height*4) throw new Error('The scene pixel data is invalid.');
  const sx=Math.max(0,Math.min(width-1,Math.round(point.x))),sy=Math.max(0,Math.min(height-1,Math.round(point.y)));
  const seed=(sy*width+sx)*4,transparent=rgba[seed+3]<245;
  const visited=new Uint8Array(width*height),queue=new Int32Array(width*height);
  let head=0,tail=1;queue[0]=sy*width+sx;visited[queue[0]]=1;
  const boundary:Point[]=[];let touchesEdge=false,minX=sx,maxX=sx,minY=sy,maxY=sy;
  // Compare with the click colour and local pixel colour. The local test permits
  // gradual lighting while the seed test stops leaks into an adjacent mount.
  const accepts=(index:number,from:number)=>{
    const offset=index*4,previous=from*4;
    if(transparent) return rgba[offset+3]<245;
    let seedDifference=0,localDifference=0;
    for(let channel=0;channel<3;channel++){
      seedDifference+=Math.abs(rgba[offset+channel]-rgba[seed+channel]);
      localDifference+=Math.abs(rgba[offset+channel]-rgba[previous+channel]);
    }
    return rgba[offset+3]>230&&seedDifference<135&&localDifference<72;
  };
  while(head<tail){
    const index=queue[head++],x=index%width,y=Math.floor(index/width);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    touchesEdge ||= x===0||y===0||x===width-1||y===height-1;
    let edge=false;
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
      if(nx<0||ny<0||nx>=width||ny>=height){edge=true;continue;}
      const next=ny*width+nx;
      if(!accepts(next,index)){edge=true;continue;}
      if(!visited[next]){visited[next]=1;queue[tail++]=next;}
    }
    if(edge)boundary.push({x,y});
  }
  if(touchesEdge||tail<16||maxX-minX<3||maxY-minY<3){
    const halfW=Math.max(2,Math.round(width*0.12)),halfH=Math.max(2,Math.round(height*0.16));
    const left=Math.max(0,sx-halfW),right=Math.min(width-1,sx+halfW),top=Math.max(0,sy-halfH),bottom=Math.min(height-1,sy+halfH);
    return {corners:{topLeft:{x:left,y:top},topRight:{x:right,y:top},bottomRight:{x:right,y:bottom},bottomLeft:{x:left,y:bottom}},confidence:'low',method:'manual'};
  }
  // Convex hull and maximum-distance simplification find angled corners without
  // assuming the opening's extrema form an axis-aligned rectangle.
  const points=boundary.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const lower:Point[]=[],upper:Point[]=[];
  for(const p of points){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}
  for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
  while(hull.length>4){let least=Infinity,remove=0;for(let i=0;i<hull.length;i++){const area=Math.abs(cross(hull[(i+hull.length-1)%hull.length],hull[i],hull[(i+1)%hull.length]));if(area<least){least=area;remove=i;}}hull.splice(remove,1);}
  if(hull.length!==4) return {corners:{topLeft:{x:minX,y:minY},topRight:{x:maxX,y:minY},bottomRight:{x:maxX,y:maxY},bottomLeft:{x:minX,y:maxY}},confidence:'low',method:transparent?'transparency':'edges'};
  const start=hull.reduce((best,p,i)=>p.x+p.y<hull[best].x+hull[best].y?i:best,0);
  const ordered=[0,1,2,3].map((offset)=>hull[(start+offset)%4]);
  const corners={topLeft:ordered[0],topRight:ordered[1],bottomRight:ordered[2],bottomLeft:ordered[3]};
  const area=Math.abs(ordered.reduce((sum,p,i)=>sum+p.x*ordered[(i+1)%4].y-ordered[(i+1)%4].x*p.y,0))/2;
  return {corners,confidence:tail/Math.max(1,area)>0.85?'high':'low',method:transparent?'transparency':'edges'};
}
