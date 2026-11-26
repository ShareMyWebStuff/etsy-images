import { describe, expect, it } from 'vitest';
import {
  constrainPaperPlacement, defaultPaperPlacement, detectOpeningAtPoint, estimateOpeningAspect,
  invertHomography, openingHomography, paperPlacementHeight, placementKey, projectPoint,
  rebaseOpeningPlacements, suggestPaperRatio, validateOurTemplateImageDefinition,
} from '@/lib/our-template-image-geometry';
import type { TemplateOpeningCorners } from '@/lib/our-category-template-composite';
import type { OurTemplateImageDefinition, OurTemplateImageOpening } from '@/lib/our-template-image-types';

const corners:TemplateOpeningCorners={topLeft:{x:30,y:20},topRight:{x:110,y:40},bottomRight:{x:80,y:160},bottomLeft:{x:0,y:140}};

describe('saved scene frame geometry',()=>{
  it('uses frame edge lengths, rather than the axis-aligned bounding box, for rotated openings',()=>{
    expect(estimateOpeningAspect(corners)).toBeCloseTo(2/3,8);
    expect(suggestPaperRatio(corners)).toMatchObject({ratio:'2x3',orientation:'portrait'});
    expect(suggestPaperRatio(corners).croppedFraction).toBeCloseTo(0,12);
    const landscape={topLeft:{x:30,y:20},topRight:{x:150,y:50},bottomRight:{x:130,y:130},bottomLeft:{x:10,y:100}};
    expect(suggestPaperRatio(landscape)).toMatchObject({ratio:'2x3',orientation:'landscape'});
  });

  it('recovers estimated frame proportions from a perspective camera with orthogonal axes',()=>{
    const yaw=.4,pitch=.25,focal=900;
    function project(x:number,y:number){const rx=Math.cos(yaw)*x,rz=-Math.sin(yaw)*x;
      const ry=Math.cos(pitch)*y-Math.sin(pitch)*rz,z=1000+Math.sin(pitch)*y+Math.cos(pitch)*rz;
      return {x:500+focal*rx/z,y:500+focal*ry/z};}
    const perspective={topLeft:project(-100,-150),topRight:project(100,-150),bottomRight:project(100,150),bottomLeft:project(-100,150)};
    expect(estimateOpeningAspect(perspective,1000,1000)).toBeCloseTo(2/3,5);
  });

  it('keeps an actual near-frontal mockup stable when a corner changes by one original pixel',()=>{
    const original:TemplateOpeningCorners={topLeft:{x:1689,y:489},topRight:{x:2492,y:488},bottomRight:{x:2489,y:1662},bottomLeft:{x:1689,y:1663}};
    const corrected={...original,bottomRight:{x:2488,y:1662}};
    const before=estimateOpeningAspect(original,4096,4096),after=estimateOpeningAspect(corrected,4096,4096);
    expect(before).toBeCloseTo(.6827081051,8);
    expect(Math.abs(after-before)).toBeLessThan(.001);
    expect(defaultPaperPlacement(after,'5x7','portrait').width).toBeLessThan(1.05);
    // Previously this single-pixel change produced aspect .3805 and a 1.877x
    // paper minimum that remained enlarged after putting the corner back.
    for(const key of ['topLeft','topRight','bottomRight','bottomLeft'] as const)for(let dx=-5;dx<=5;dx++)for(let dy=-5;dy<=5;dy++){
      const moved={...original,[key]:{x:original[key].x+dx,y:original[key].y+dy}};
      expect(Math.abs(estimateOpeningAspect(moved,4096,4096)-before)).toBeLessThan(.01);
    }
  });

  it('rebases every saved ratio without ratcheting default or intentional zoom and pan after a corner roundtrip',()=>{
    const original:TemplateOpeningCorners={topLeft:{x:1689,y:489},topRight:{x:2492,y:488},bottomRight:{x:2489,y:1662},bottomLeft:{x:1689,y:1663}};
    const changed:TemplateOpeningCorners={topLeft:{x:1589,y:489},topRight:{x:2592,y:488},bottomRight:{x:2589,y:1662},bottomLeft:{x:1589,y:1663}};
    const aspect=estimateOpeningAspect(original,4096,4096);
    const base=defaultPaperPlacement(aspect,'5x7','portrait');
    const zoomWidth=defaultPaperPlacement(aspect,'iso-a1','portrait').width*2,zoomHeight=paperPlacementHeight({x:0,y:0,width:zoomWidth},aspect,'iso-a1','portrait');
    const landscapeWidth=defaultPaperPlacement(aspect,'4x5','landscape').width*1.5,landscapeHeight=paperPlacementHeight({x:0,y:0,width:landscapeWidth},aspect,'4x5','landscape');
    const opening:OurTemplateImageOpening={id:'actual',name:'Cosy room',corners:original,imageItemNumber:1,ratio:'5x7',orientation:'portrait',placements:{
      '5x7:portrait':base,
      'iso-a1:portrait':{width:zoomWidth,x:(1-zoomWidth)*.2,y:(1-zoomHeight)*.8},
      '4x5:landscape':{width:landscapeWidth,x:(1-landscapeWidth)*.7,y:(1-landscapeHeight)*.3},
    }};
    const next=rebaseOpeningPlacements(opening,changed,4096,4096),nextAspect=estimateOpeningAspect(changed,4096,4096);
    expect(next['5x7:portrait']).toEqual(defaultPaperPlacement(nextAspect,'5x7','portrait'));
    const zoomed=next['iso-a1:portrait']!;
    expect(zoomed.width/defaultPaperPlacement(nextAspect,'iso-a1','portrait').width).toBeCloseTo(2,10);
    expect(zoomed.x/(1-zoomed.width)).toBeCloseTo(.2,10);
    expect(zoomed.y/(1-paperPlacementHeight(zoomed,nextAspect,'iso-a1','portrait'))).toBeCloseTo(.8,10);
    const restored=rebaseOpeningPlacements({...opening,corners:changed,placements:next},original,4096,4096);
    for(const key of Object.keys(opening.placements) as Array<keyof typeof opening.placements>){
      expect(restored[key]!.width).toBeCloseTo(opening.placements[key]!.width,10);
      expect(restored[key]!.x).toBeCloseTo(opening.placements[key]!.x,10);
      expect(restored[key]!.y).toBeCloseTo(opening.placements[key]!.y,10);
    }
  });

  it('centres the minimum ratio-correct paper and constrains zoom and movement to cover every corner',()=>{
    const aspect=4/5,initial=defaultPaperPlacement(aspect,'iso-a1','portrait');
    expect(initial.width).toBe(1);
    const height=paperPlacementHeight(initial,aspect,'iso-a1','portrait');
    expect(initial.y).toBeCloseTo((1-height)/2);
    const moved=constrainPaperPlacement({x:200,y:-200,width:initial.width*2},aspect,'iso-a1','portrait');
    const h=paperPlacementHeight(moved,aspect,'iso-a1','portrait');
    expect(moved.x).toBeLessThanOrEqual(0);expect(moved.x+moved.width).toBeGreaterThanOrEqual(1);
    expect(moved.y).toBeLessThanOrEqual(0);expect(moved.y+h).toBeGreaterThanOrEqual(1);
    expect(moved.width*aspect/h).toBeCloseTo(1/Math.SQRT2);
    expect(constrainPaperPlacement({x:1,y:1,width:0.1},aspect,'iso-a1','portrait').width).toBe(initial.width);
  });

  it('round-trips perspective coordinates without depending on rendered preview size',()=>{
    const forward=openingHomography(corners),inverse=invertHomography(forward);
    for(const point of [{x:0,y:0},{x:1,y:1},{x:.23,y:.77}]){
      const restored=projectPoint(inverse,projectPoint(forward,point));
      expect(restored.x).toBeCloseTo(point.x,9);expect(restored.y).toBeCloseTo(point.y,9);
    }
  });

  it('saves separate placements for each ratio and restores the original corrected corners',()=>{
    const definition:OurTemplateImageDefinition={width:180,height:200,lightingMode:'auto',openings:[{
      id:'one',name:'Nursery print',corners,imageItemNumber:2,ratio:'iso-a1',orientation:'portrait',placements:{
        [placementKey('iso-a1','portrait')]:{x:-.2,y:-.2,width:1.5},
        [placementKey('4x5','portrait')]:{x:-.1,y:-.1,width:1.4},
      },
    }]};
    const saved=validateOurTemplateImageDefinition(JSON.parse(JSON.stringify(definition)));
    expect(saved.openings[0].corners).toEqual(corners);
    expect(saved.openings[0].placements['iso-a1:portrait']).toEqual({x:-.2,y:-.2,width:1.5});
    expect(saved.openings[0].placements['4x5:portrait']).toEqual({x:-.1,y:-.1,width:1.4});
    expect(()=>validateOurTemplateImageDefinition(definition,100,100)).toThrow(/dimensions/);
  });

  it('rejects crossed corners and malformed saved ratios',()=>{
    const base={width:180,height:200,lightingMode:'auto',openings:[{id:'one',name:'Print',corners,imageItemNumber:1,ratio:'2x3',orientation:'portrait',placements:{}}]};
    expect(()=>validateOurTemplateImageDefinition({...base,openings:[{...base.openings[0],corners:{...corners,topRight:corners.bottomLeft,bottomLeft:corners.topRight}}]})).toThrow(/convex/);
    expect(()=>validateOurTemplateImageDefinition({...base,openings:[{...base.openings[0],placements:{invalid:{x:0,y:0,width:1}}}]})).toThrow(/unsupported/);
  });

  it('allows an empty opening list only when the trusted No areas caller opts in',()=>{
    const definition={width:180,height:200,lightingMode:'auto',openings:[]};
    expect(()=>validateOurTemplateImageDefinition(definition)).toThrow(/1 and 50/);
    expect(validateOurTemplateImageDefinition(definition,180,200,{allowEmptyOpenings:true}).openings).toEqual([]);
    expect(()=>validateOurTemplateImageDefinition(definition,100,100,{allowEmptyOpenings:true})).toThrow(/dimensions/);
  });
});

describe('clicked frame opening detection',()=>{
  function image(alpha:number,colour=230){const data=new Uint8Array(100*100*4);for(let i=0;i<10000;i++){data[i*4]=data[i*4+1]=data[i*4+2]=colour;data[i*4+3]=255;}
    for(const [left,right] of [[10,35],[60,85]])for(let y=15;y<80;y++)for(let x=left;x<=right;x++){
      const offset=(y*100+x)*4;data[offset]=data[offset+1]=data[offset+2]=80;data[offset+3]=alpha;}
    return data;}
  it('detects the clicked transparent frame independently of another opening',()=>{
    const data=image(0),first=detectOpeningAtPoint(data,100,100,{x:20,y:50}),second=detectOpeningAtPoint(data,100,100,{x:70,y:50});
    expect(first.method).toBe('transparency');expect(first.corners.topLeft).toEqual({x:10,y:15});
    expect(second.corners.topLeft).toEqual({x:60,y:15});expect(second.corners.bottomRight).toEqual({x:85,y:79});
    expect(first.corners.topLeft).toEqual({x:10,y:15});
  });
  it('detects ordinary flattened print edges without pink placeholders',()=>{
    const result=detectOpeningAtPoint(image(255),100,100,{x:70,y:50});
    expect(result).toMatchObject({method:'edges',confidence:'high',corners:{topLeft:{x:60,y:15},bottomRight:{x:85,y:79}}});
  });
  it('provides a visible manual fallback when a print cannot be separated from its mount',()=>{
    const result=detectOpeningAtPoint(new Uint8Array(100*100*4).fill(255),100,100,{x:50,y:50});
    expect(result).toMatchObject({method:'manual',confidence:'low'});
    expect(result.corners.topLeft.x).toBeLessThan(50);expect(result.corners.bottomRight.y).toBeGreaterThan(50);
  });
});
