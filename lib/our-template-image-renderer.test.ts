import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ListingPrintCropSettings } from '@/lib/listing-print-crops';
import { renderOurTemplateImage, validateOurTemplateImagePair } from '@/lib/our-template-image-renderer';
import type { OurTemplateImageDefinition, OurTemplateImageForegroundMask, OurTemplateImageOpening } from '@/lib/our-template-image-types';

const width=120,height=100;
function opening(id='one',imageItemNumber=1):OurTemplateImageOpening{return {id,name:id,corners:{topLeft:{x:20,y:10},topRight:{x:79,y:10},bottomRight:{x:79,y:89},bottomLeft:{x:20,y:89}},imageItemNumber,ratio:'4x5',orientation:'portrait',placements:{}};}
function definition(openings=[opening()],lightingMode:OurTemplateImageDefinition['lightingMode']='auto'):OurTemplateImageDefinition{return {width,height,openings,lightingMode};}
async function png(pixel:(x:number,y:number)=>number[],w=width,h=height){const data=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(pixel(x,y),(y*w+x)*4);return sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer();}
async function solid(colour:number[]){return png(()=>colour,80,100);}
async function pixels(contents:Buffer){return sharp(contents).ensureAlpha().raw().toBuffer();}
function at(data:Buffer,x:number,y:number){return [...data.subarray((y*width+x)*4,(y*width+x)*4+4)];}
const inside=(x:number,y:number)=>x>=20&&x<=79&&y>=10&&y<=89;

describe('Our Template Images shared compositor',()=>{
  it('replaces opaque print pixels and preserves every pixel outside the configured opening',async()=>{
    const scene=await png(()=>[230,220,210,255]);
    const rendered=await pixels(await renderOurTemplateImage({scene,definition:definition(),artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,50,50)).toEqual([200,100,50,255]);expect(at(rendered,19,50)).toEqual([230,220,210,255]);
    expect(at(rendered,80,50)).toEqual([230,220,210,255]);
  });

  it('draws artwork under the original translucent shadow and opaque foreground objects',async()=>{
    const scene=await png((x,y)=>{
      if(!inside(x,y))return [230,220,210,255];
      if(x===50&&y===50)return [33,44,55,255];
      return x<y?[0,0,0,128]:[0,0,0,0];
    });
    const rendered=await pixels(await renderOurTemplateImage({scene,definition:definition(),artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,30,60)).toEqual([100,50,25,255]);
    expect(at(rendered,70,20)).toEqual([200,100,50,255]);
    expect(at(rendered,50,50)).toEqual([33,44,55,255]);
    expect(at(rendered,19,60)).toEqual([230,220,210,255]);
  });

  it('reconstructs diagonal lighting from paired Canva exports and preserves the original room outside',async()=>{
    const scene=await png(()=>[230,220,210,255]);
    const whiteScene=await png((x,y)=>inside(x,y)?(x<y?[128,128,128,255]:[255,255,255,255]):[230,220,210,255]);
    const blackScene=await png((x,y)=>inside(x,y)?[0,0,0,255]:[230,220,210,255]);
    const rendered=await pixels(await renderOurTemplateImage({scene,whiteScene,blackScene,definition:definition([opening()],'paired'),artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,30,60)).toEqual([100,50,25,255]);expect(at(rendered,70,20)).toEqual([200,100,50,255]);
    expect(at(rendered,19,60)).toEqual([230,220,210,255]);
  });

  it('keeps an opaque foreground limb, soft fur edge and translucent shadow over new artwork using a flattened white/black pair',async()=>{
    // Both Canva exports are completely opaque. Their difference carries the
    // visibility mask even though PNG alpha cannot identify this bunny limb.
    function exportPixel(x:number,y:number,white:boolean){
      if(!inside(x,y))return [230,220,210,255];
      if(x>=40&&x<=50&&y>=20&&y<=60)return [140,110,80,255]; // Fully opaque foreground: identical in both exports.
      if(x===51&&y>=20&&y<=60)return white?[228,208,188,255]:[100,80,60,255]; // Half-covered fur edge.
      if(x>=30&&x<=60&&y>=70&&y<=75)return white?[128,128,128,255]:[0,0,0,255]; // Half-strength shadow over the print.
      return white?[255,255,255,255]:[0,0,0,255];
    }
    const whiteScene=await png((x,y)=>exportPixel(x,y,true));
    const blackScene=await png((x,y)=>exportPixel(x,y,false));
    const rendered=await pixels(await renderOurTemplateImage({scene:whiteScene,whiteScene,blackScene,
      definition:definition([opening()],'paired'),artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,45,40)).toEqual([140,110,80,255]);
    expect(at(rendered,51,40)).toEqual([200,130,85,255]);
    expect(at(rendered,30,72)).toEqual([100,50,25,255]);
    expect(at(rendered,70,20)).toEqual([200,100,50,255]);
    expect(at(rendered,19,40)).toEqual([230,220,210,255]);
  });

  it('rejects mismatched dimensions, identical pairs and reversed black/white exports',async()=>{
    const white=await png(()=>[240,240,240,255]),black=await png(()=>[0,0,0,255]);
    await expect(validateOurTemplateImagePair(white,await solid([0,0,0,255]),definition())).rejects.toThrow(/same dimensions/);
    await expect(validateOurTemplateImagePair(white,white,definition())).rejects.toThrow(/unusable/);
    await expect(validateOurTemplateImagePair(black,white,definition())).rejects.toThrow(/unusable/);
  });

  it('rejects same-size exports of different rooms and whole-image white/black substitutes',async()=>{
    const white=await png((x,y)=>inside(x,y)?[255,255,255,255]:[230,220,210,255]);
    const differentRoom=await png((x,y)=>inside(x,y)?[0,0,0,255]:[100,150,180,255]);
    await expect(validateOurTemplateImagePair(white,differentRoom,definition())).rejects.toThrow(/unusable.*outside the selected print openings/);
    await expect(validateOurTemplateImagePair(await png(()=>[255,255,255,255]),await png(()=>[0,0,0,255]),definition())).rejects.toThrow(/outside the selected print openings/);
  });

  it('allows small PNG pixel noise and a two-pixel opening edge tolerance',async()=>{
    const white=await png((x,y)=>inside(x,y)||x>=18&&x<=81&&y>=8&&y<=91?[255,255,255,255]:[230,220,210,255]);
    const black=await png((x,y)=>inside(x,y)||x>=18&&x<=81&&y>=8&&y<=91?[0,0,0,255]:[232,218,212,255]);
    await expect(validateOurTemplateImagePair(white,black,definition())).resolves.toBeUndefined();
  });

  it('rejects significant negative white-minus-black differences in any colour channel',async()=>{
    const white=await png((x,y)=>inside(x,y)?(x<26&&y<16?[100,200,200,255]:[230,230,230,255]):[220,220,220,255]);
    const black=await png((x,y)=>inside(x,y)?(x<26&&y<16?[120,0,0,255]:[0,0,0,255]):[220,220,220,255]);
    await expect(validateOurTemplateImagePair(white,black,definition())).rejects.toThrow(/unusable/);
  });

  it('assigns different artwork to two angled frames, retaining the correct perspective and clipping',async()=>{
    const first={...opening('left',1),corners:{topLeft:{x:5,y:10},topRight:{x:45,y:15},bottomRight:{x:40,y:85},bottomLeft:{x:2,y:80}}};
    const second={...opening('right',2),corners:{topLeft:{x:70,y:15},topRight:{x:110,y:10},bottomRight:{x:115,y:80},bottomLeft:{x:75,y:85}}};
    const rendered=await pixels(await renderOurTemplateImage({scene:await png(()=>[220,220,220,255]),definition:definition([first,second]),artworks:new Map([[1,{contents:await solid([200,0,0,255])}],[2,{contents:await solid([0,0,200,255])}]])}));
    expect(at(rendered,25,45)).toEqual([200,0,0,255]);expect(at(rendered,90,45)).toEqual([0,0,200,255]);
    expect(at(rendered,60,45)).toEqual([220,220,220,255]);expect(at(rendered,45,80)).toEqual([220,220,220,255]);
  });

  it('uses the artwork saved crop for the selected ratio and defaults uploads to a centred crop',async()=>{
    const art=await png((x)=>x<100?[200,0,0,255]:[0,0,200,255],200,100);
    const settings={orientation:'portrait',regions:{'4x5':{x:.5,y:0,width:.5,height:1}}} as ListingPrintCropSettings;
    const rendered=await pixels(await renderOurTemplateImage({scene:await png(()=>[220,220,220,255]),definition:definition(),artworks:new Map([[1,{contents:art,cropSettings:settings}]])}));
    expect(at(rendered,50,50)[0]).toBeLessThan(3);expect(at(rendered,50,50)[2]).toBeGreaterThan(197);
    const defaultRendered=await pixels(await renderOurTemplateImage({scene:await png(()=>[220,220,220,255]),definition:definition(),artworks:new Map([[1,{contents:art}]])}));
    expect(at(defaultRendered,25,50)).toEqual([200,0,0,255]);expect(at(defaultRendered,75,50)).toEqual([0,0,200,255]);
  });

  it('retains the saved artwork placement and its paper margin using the printable-download rendering path',async()=>{
    const settings={orientation:'portrait',regions:{'4x5':{x:0,y:0,width:1,height:1}},placements:{'4x5':{x:.25,y:.25,width:.5,height:.5}}} as ListingPrintCropSettings;
    const rendered=await pixels(await renderOurTemplateImage({scene:await png(()=>[220,220,220,255]),definition:definition(),artworks:new Map([[1,{contents:await solid([200,0,0,255]),cropSettings:settings,backgroundColour:'#FFFFFF'}]])}));
    expect(at(rendered,25,50)).toEqual([255,255,255,255]);
    expect(at(rendered,50,50)[0]).toBeGreaterThan(195);expect(at(rendered,50,50)[1]).toBeLessThan(5);
  });

  it('keeps ratio-correct paper behind a different-shaped mount and applies its saved placement',async()=>{
    const chosen={...opening(),ratio:'2x3' as const,placements:{'2x3:portrait':{x:-.25,y:-.25,width:1.5}}};
    const art=await png((_x,y)=>[y*2,0,0,255],80,120);
    const scene=await png(()=>[220,220,220,255]);
    const rendered=await pixels(await renderOurTemplateImage({scene,definition:definition([chosen]),artworks:new Map([[1,{contents:art}]])}));
    expect(at(rendered,50,10)[0]).toBeGreaterThan(0);expect(at(rendered,50,89)[0]).toBeLessThan(238);
    expect(at(rendered,19,50)).toEqual([220,220,220,255]);
  });

  it('explains which missing artwork item is required',async()=>{
    await expect(renderOurTemplateImage({scene:await png(()=>[220,220,220,255]),definition:definition([opening('Nursery',2)]),artworks:new Map()})).rejects.toThrow(/item 2.*Nursery/);
  });

  it('keeps painted opaque foreground, feathers its edge, erases it back to artwork and ignores paint outside openings',async()=>{
    const scene=await png((x,y)=>inside(x,y)?[140,110,80,255]:[230,220,210,255]);
    const foregroundMask:OurTemplateImageForegroundMask={version:1,strokes:[
      {mode:'paint',size:6,softness:0,points:[{x:35,y:20},{x:35,y:60}]},
      {mode:'paint',size:20,softness:1,points:[{x:50,y:50}]},
      {mode:'erase',size:4,softness:0,points:[{x:50,y:50}]},
      {mode:'paint',size:10,softness:0,points:[{x:10,y:50}]},
    ]};
    const rendered=await pixels(await renderOurTemplateImage({scene,definition:{...definition(),foregroundMask},artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,35,30)).toEqual([140,110,80,255]);
    expect(at(rendered,55,50)).toEqual([170,105,65,255]);
    expect(at(rendered,50,50)).toEqual([200,100,50,255]);
    expect(at(rendered,70,50)).toEqual([200,100,50,255]);
    expect(at(rendered,10,50)).toEqual([230,220,210,255]);
  });

  it('does not apply translucent original foreground twice when auto transparency already preserves it',async()=>{
    const scene=await png((x,y)=>inside(x,y)?[0,0,0,128]:[230,220,210,255]);
    const artwork=await solid([200,100,50,255]);
    const input={scene,definition:definition(),artworks:new Map([[1,{contents:artwork}]])};
    const original=await renderOurTemplateImage(input);
    const painted=await renderOurTemplateImage({...input,definition:{...input.definition,foregroundMask:{version:1,strokes:[{mode:'paint',size:100,softness:0,points:[{x:50,y:50}]}]}}});
    expect(painted).toEqual(original);
    expect(at(await pixels(painted),50,50)).toEqual([100,50,25,255]);
  });

  it('preserves original alpha when manual foreground is used with opaque replacement',async()=>{
    const scene=await png((x,y)=>inside(x,y)?(x<50?[0,200,0,0]:[0,0,0,128]):[230,220,210,255]);
    const configured:OurTemplateImageDefinition={...definition([opening()],'opaque'),foregroundMask:{version:1,strokes:[{mode:'paint',size:100,softness:0,points:[{x:50,y:50}]}]}};
    const rendered=await pixels(await renderOurTemplateImage({scene,definition:configured,artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,30,50)).toEqual([200,100,50,255]);
    expect(at(rendered,60,50)).toEqual([100,50,25,255]);
  });

  it('does not double shadows recovered by a pair when the original foreground is translucent',async()=>{
    const scene=await png((x,y)=>inside(x,y)?[0,0,0,128]:[230,220,210,255]);
    const whiteScene=await png((x,y)=>inside(x,y)?[128,128,128,255]:[230,220,210,255]);
    const blackScene=await png((x,y)=>inside(x,y)?[0,0,0,255]:[230,220,210,255]);
    const input={scene,whiteScene,blackScene,definition:definition([opening()],'paired'),artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])};
    const original=await renderOurTemplateImage(input);
    const painted=await renderOurTemplateImage({...input,definition:{...input.definition,foregroundMask:{version:1,strokes:[{mode:'paint',size:100,softness:0,points:[{x:50,y:50}]}]}}});
    expect(painted).toEqual(original);
    expect(at(await pixels(painted),50,50)).toEqual([100,50,25,255]);
  });

  it('uses one scene foreground mask across multiple openings with repeated artwork',async()=>{
    const first={...opening('left'),corners:{topLeft:{x:5,y:10},topRight:{x:45,y:15},bottomRight:{x:40,y:85},bottomLeft:{x:2,y:80}}};
    const second={...opening('right'),corners:{topLeft:{x:70,y:15},topRight:{x:110,y:10},bottomRight:{x:115,y:80},bottomLeft:{x:75,y:85}}};
    const foregroundMask:OurTemplateImageForegroundMask={version:1,strokes:[{mode:'paint',size:8,softness:0,points:[{x:25,y:45},{x:90,y:45}]}]};
    const rendered=await pixels(await renderOurTemplateImage({scene:await png(()=>[140,110,80,255]),definition:{...definition([first,second]),foregroundMask},artworks:new Map([[1,{contents:await solid([200,100,50,255])}]])}));
    expect(at(rendered,25,45)).toEqual([140,110,80,255]);
    expect(at(rendered,90,45)).toEqual([140,110,80,255]);
    expect(at(rendered,25,30)).toEqual([200,100,50,255]);
    expect(at(rendered,90,30)).toEqual([200,100,50,255]);
  });

});
