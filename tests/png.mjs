import {inflateSync,deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
// Chrome screenshot PNG subset: non-interlaced 8-bit RGB/RGBA, all five PNG filters.
export function decodePNG(bytes){
  assert.equal(bytes.subarray(1,4).toString(),'PNG');
  let width,height,bpp;const parts=[];
  for(let pos=8;pos<bytes.length;){
    const len=bytes.readUInt32BE(pos);const type=bytes.toString('ascii',pos+4,pos+8);const data=bytes.subarray(pos+8,pos+8+len);pos+=len+12;
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);assert.ok([2,6].includes(data[9]));assert.equal(data[12],0);bpp=data[9]===2?3:4;}
    if(type==='IDAT')parts.push(data);
  }
  const raw=inflateSync(Buffer.concat(parts)), stride=width*bpp, pixels=Buffer.alloc(height*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=bpp?pixels[i-bpp]:0,b=y?pixels[i-stride]:0,c=y&&x>=bpp?pixels[i-stride-bpp]:0;
      pixels[i]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;
    }
  }
  return {width,height,bpp,pixels};
}
export function diffPNG(a,b){
  const x=decodePNG(a),y=decodePNG(b);
  const width=Math.max(x.width,y.width),height=Math.max(x.height,y.height),mask=Buffer.alloc(width*height*3,255);
  let changed=0;
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const different=row>=x.height||row>=y.height||col>=x.width||col>=y.width||[0,1,2].some(c=>x.pixels[(row*x.width+col)*x.bpp+c]!==y.pixels[(row*y.width+col)*y.bpp+c]);
    if(different){changed++;const i=(row*width+col)*3;mask[i]=255;mask[i+1]=0;mask[i+2]=80;}
  }
  return {width,height,heightDelta:y.height-x.height,widthDelta:y.width-x.width,changed,total:width*height,percent:changed/(width*height)*100,mask:encodePNG(width,height,mask)};
}

// Small RGB PNG encoder for regression masks (zlib and CRC32 only).
export function encodePNG(width,height,rgb){
  const crc=buffer=>{let n=0xffffffff;for(const b of buffer){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)rgb.copy(raw,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
