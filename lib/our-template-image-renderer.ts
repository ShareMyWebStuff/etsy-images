import sharp from 'sharp';

import type { ListingPrintCropSettings } from '@/lib/listing-print-crops';
import type { ArtworkBackgroundColour } from '@/lib/artwork-background-colours';
import { createPrintableDownload } from '@/lib/printable-download-generator';
import {
  constrainPaperPlacement,
  defaultPaperPlacement,
  estimateOpeningAspect,
  invertHomography,
  openingHomography,
  paperAspect,
  paperPlacementHeight,
  placementKey,
  projectPoint,
  validateOurTemplateImageDefinition,
} from '@/lib/our-template-image-geometry';
import type { OurTemplateImageDefinition, OurTemplateImageOpening } from '@/lib/our-template-image-types';
import { maskAlphaAtPixel, rasterizeForegroundMask } from '@/lib/our-template-image-foreground-mask';

export type OurTemplateImageArtwork = { contents: Buffer; cropSettings?: ListingPrintCropSettings | null; backgroundColour?: ArtworkBackgroundColour };
export type RenderOurTemplateImageInput = {
  scene: Buffer;
  definition: OurTemplateImageDefinition;
  artworks: Map<number, OurTemplateImageArtwork>;
  whiteScene?: Buffer;
  blackScene?: Buffer;
};

async function decode(contents: Buffer) {
  return sharp(contents, {failOn:'error',limitInputPixels:64000000})
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
}

function openingBounds(opening:OurTemplateImageOpening,width:number,height:number) {
  const points=Object.values(opening.corners);
  return {left:Math.max(0,Math.floor(Math.min(...points.map((p)=>p.x)))),
    right:Math.min(width-1,Math.ceil(Math.max(...points.map((p)=>p.x)))),
    top:Math.max(0,Math.floor(Math.min(...points.map((p)=>p.y)))),
    bottom:Math.min(height-1,Math.ceil(Math.max(...points.map((p)=>p.y))))};
}

function inOpening(inverse:number[],x:number,y:number) {
  const point=projectPoint(inverse,{x,y});
  return point.x>=-1e-8&&point.x<=1+1e-8&&point.y>=-1e-8&&point.y<=1+1e-8?point:null;
}

/** Conservative scanline ranges include a small band for corrected corners and antialiasing. */
function openingRangesAtRow(definition:OurTemplateImageDefinition,y:number,tolerance:number) {
  const ranges:Array<[number,number]>=[];
  for(const opening of definition.openings){
    const points=[opening.corners.topLeft,opening.corners.topRight,opening.corners.bottomRight,opening.corners.bottomLeft];
    const xs:number[]=[];
    for(let index=0;index<4;index++){
      const first=points[index],second=points[(index+1)%4],dy=second.y-first.y;
      if(Math.abs(dy)<1e-10){
        if(Math.abs(y-first.y)<=tolerance)xs.push(first.x,second.x);
        continue;
      }
      const firstT=(y-tolerance-first.y)/dy,secondT=(y+tolerance-first.y)/dy;
      const from=Math.max(0,Math.min(firstT,secondT)),to=Math.min(1,Math.max(firstT,secondT));
      if(from<=to)xs.push(first.x+(second.x-first.x)*from,first.x+(second.x-first.x)*to);
    }
    if(xs.length)ranges.push([Math.max(0,Math.floor(Math.min(...xs))-tolerance),Math.min(definition.width-1,Math.ceil(Math.max(...xs))+tolerance)]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged:Array<[number,number]>=[];
  for(const range of ranges){
    const previous=merged.at(-1);
    if(previous&&range[0]<=previous[1]+1)previous[1]=Math.max(previous[1],range[1]);
    else merged.push(range);
  }
  return merged;
}

function validatePairRoomIsUnchanged(white:Buffer,black:Buffer,definition:OurTemplateImageDefinition){
  // Do not accept arbitrary same-size photos (or a whole white and black PNG).
  // Only the selected print openings may change between the two room exports.
  const tolerance=Math.max(2,Math.ceil(Math.max(definition.width,definition.height)*0.0005));
  let outside=0,changed=0,totalDifference=0;
  for(let y=0;y<definition.height;y++){
    const ranges=openingRangesAtRow(definition,y,tolerance);let rangeIndex=0;
    for(let x=0;x<definition.width;x++){
      while(rangeIndex<ranges.length&&x>ranges[rangeIndex][1])rangeIndex++;
      if(rangeIndex<ranges.length&&x>=ranges[rangeIndex][0]){x=ranges[rangeIndex][1];continue;}
      const offset=(y*definition.width+x)*4;outside++;
      let maximumDifference=Math.abs(white[offset+3]-black[offset+3]);
      for(let channel=0;channel<3;channel++){
        const difference=Math.abs(white[offset+channel]-black[offset+channel]);
        maximumDifference=Math.max(maximumDifference,difference);totalDifference+=difference;
      }
      if(maximumDifference>12)changed++;
    }
  }
  if(changed>Math.max(8,outside*0.005)||outside>0&&totalDifference/(outside*3)>3){
    throw new Error('The white/black pair is unusable: the room changes outside the selected print openings. Export the identical room twice and change only the artwork from pure white to pure black. Keep the scene, camera, crop and lighting unchanged.');
  }
}

function validateDecodedPair(white:Awaited<ReturnType<typeof decode>>,black:Awaited<ReturnType<typeof decode>>,definition:OurTemplateImageDefinition) {
  if(white.info.width!==definition.width||white.info.height!==definition.height||black.info.width!==definition.width||black.info.height!==definition.height) {
    throw new Error('The white-artwork and black-artwork Canva PNGs must have the same dimensions as the original room scene.');
  }
  for(const opening of definition.openings){
    const bounds=openingBounds(opening,definition.width,definition.height),inverse=invertHomography(openingHomography(opening.corners));
    let samples=0,visible=0,reversed=0,transparent=0;
    for(let y=bounds.top;y<=bounds.bottom;y++)for(let x=bounds.left;x<=bounds.right;x++){
      if(!inOpening(inverse,x,y))continue;
      const offset=(y*definition.width+x)*4;samples++;
      if(white.data[offset+3]<250||black.data[offset+3]<250)transparent++;
      const differences=[0,1,2].map((channel)=>white.data[offset+channel]-black.data[offset+channel]);
      if(Math.max(...differences)>16)visible++;
      if(Math.min(...differences)<-8)reversed++;
    }
    if(samples===0||visible<Math.max(4,samples*0.01)||reversed>Math.max(4,samples*0.0025)||transparent>samples*0.025) {
      throw new Error(`The white/black pair is unusable for "${opening.name}". Export the same opaque room twice, changing only its artwork from pure white to pure black. Keep the camera, crop and all other layers unchanged.`);
    }
  }
  validatePairRoomIsUnchanged(white.data,black.data,definition);
}

export async function validateOurTemplateImagePair(whiteScene:Buffer,blackScene:Buffer,definition:OurTemplateImageDefinition):Promise<void> {
  const [white,black]=await Promise.all([decode(whiteScene),decode(blackScene)]);
  validateDecodedPair(white,black,validateOurTemplateImageDefinition(definition));
}

async function artworkPlane(artwork:OurTemplateImageArtwork,opening:OurTemplateImageOpening,sceneWidth:number,sceneHeight:number) {
  const aspect=paperAspect(opening.ratio,opening.orientation);
  const physicalAspect=estimateOpeningAspect(opening.corners,sceneWidth,sceneHeight);
  const p=constrainPaperPlacement(opening.placements[placementKey(opening.ratio,opening.orientation)]??defaultPaperPlacement(physicalAspect,opening.ratio,opening.orientation),physicalAspect,opening.ratio,opening.orientation);
  const points=Object.values(opening.corners);
  const extent=Math.max(Math.max(...points.map((p)=>p.x))-Math.min(...points.map((p)=>p.x)),Math.max(...points.map((p)=>p.y))-Math.min(...points.map((p)=>p.y)));
  const longEdge=Math.max(16,Math.min(4096,Math.ceil(extent*Math.max(p.width,paperPlacementHeight(p,physicalAspect,opening.ratio,opening.orientation))*1.5)));
  const width=aspect>=1?longEdge:Math.max(1,Math.round(longEdge*aspect));
  const height=aspect>=1?Math.max(1,Math.round(longEdge/aspect)):longEdge;
  let source=artwork.contents;
  const settings=artwork.cropSettings;
  if(settings&&settings.orientation===opening.orientation&&settings.regions[opening.ratio]){
    // Reuse printable-download placement so saved white margins and extended
    // crops behave exactly as they do in the rest of listing generation.
    const paper=await createPrintableDownload(source,opening.ratio,'Scene preview',{width,height},
      settings.regions[opening.ratio],settings.placements?.[opening.ratio],artwork.backgroundColour);
    source=paper.buffer;
  }
  const raster=await sharp(source,{failOn:'error',limitInputPixels:64000000}).rotate().resize({width,height,fit:'cover',position:'centre',kernel:sharp.kernel.lanczos3})
    .flatten({background:'#ffffff'}).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  return {raster,width,height,placement:p,placementHeight:paperPlacementHeight(p,physicalAspect,opening.ratio,opening.orientation)};
}

function sample(raster:Buffer,width:number,height:number,u:number,v:number,channel:number){
  const x=Math.max(0,Math.min(width-1,u*(width-1))),y=Math.max(0,Math.min(height-1,v*(height-1)));
  const x0=Math.floor(x),x1=Math.min(width-1,x0+1),y0=Math.floor(y),y1=Math.min(height-1,y0+1),wx=x-x0,wy=y-y0;
  return ((1-wx)*raster[(y0*width+x0)*4+channel]+wx*raster[(y0*width+x1)*4+channel])*(1-wy)
    +((1-wx)*raster[(y1*width+x0)*4+channel]+wx*raster[(y1*width+x1)*4+channel])*wy;
}

/** Shared by saved-scene Test previews and ordinary listing image generation. */
export async function renderOurTemplateImage(input:RenderOurTemplateImageInput):Promise<Buffer> {
  const decoded=await decode(input.scene),{width,height}=decoded.info;
  const definition=validateOurTemplateImageDefinition(input.definition,width,height);
  let pair:{white:Awaited<ReturnType<typeof decode>>;black:Awaited<ReturnType<typeof decode>>}|undefined;
  if(definition.lightingMode==='paired'){
    if(!input.whiteScene||!input.blackScene)throw new Error('Import both the white-artwork and black-artwork PNGs for paired lighting.');
    const [white,black]=await Promise.all([decode(input.whiteScene),decode(input.blackScene)]);
    validateDecodedPair(white,black,definition);pair={white,black};
  }
  // Keep the original foreground intact. In particular, do not clear a polygon
  // before compositing: its semi-transparent foreground contains the shadows.
  const output=Buffer.from(decoded.data);
  const foregroundMask=definition.foregroundMask?.strokes.length
    ? rasterizeForegroundMask(definition.foregroundMask,width,height):null;
  for(const opening of definition.openings){
    const artwork=input.artworks.get(opening.imageItemNumber);
    if(!artwork)throw new Error(`Supply artwork item ${opening.imageItemNumber} for "${opening.name}".`);
    const plane=await artworkPlane(artwork,opening,width,height);
    const inverse=invertHomography(openingHomography(opening.corners)),bounds=openingBounds(opening,width,height);
    let transparent=false;
    if(definition.lightingMode==='auto'){
      search:for(let y=bounds.top;y<=bounds.bottom;y++)for(let x=bounds.left;x<=bounds.right;x++){
        if(decoded.data[(y*width+x)*4+3]<250&&inOpening(inverse,x,y)){transparent=true;break search;}
      }
    }
    for(let y=bounds.top;y<=bounds.bottom;y++)for(let x=bounds.left;x<=bounds.right;x++){
      const position=inOpening(inverse,x,y);if(!position)continue;
      const u=(position.x-plane.placement.x)/plane.placement.width,v=(position.y-plane.placement.y)/plane.placementHeight;
      const offset=(y*width+x)*4;
      const originalAlpha=decoded.data[offset+3]/255;
      // Auto transparency and paired exports already contain the source's
      // translucent foreground. Applying it again would darken soft shadows.
      const restore=foregroundMask&&!transparent&&(!pair||originalAlpha===1)
        ? maskAlphaAtPixel(foregroundMask,x,y)*originalAlpha:0;
      for(let channel=0;channel<3;channel++){
        const colour=sample(plane.raster,plane.width,plane.height,u,v,channel);
        if(pair){
          const black=pair.black.data[offset+channel],transmission=Math.max(0,pair.white.data[offset+channel]-black)/255;
          output[offset+channel]=Math.round(Math.min(255,black+colour*transmission));
        }else if(transparent){
          const alpha=decoded.data[offset+3]/255;
          output[offset+channel]=Math.round(decoded.data[offset+channel]*alpha+colour*(1-alpha));
        }else output[offset+channel]=Math.round(colour);
        if(restore>0)output[offset+channel]=Math.round(output[offset+channel]*(1-restore)+decoded.data[offset+channel]*restore);
      }
      output[offset+3]=255;
    }
  }
  return sharp(output,{raw:{width,height,channels:4}}).png().toBuffer();
}
