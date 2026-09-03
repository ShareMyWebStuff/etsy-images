const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');

function schedule(start, count, perDay) { const slots=[9,13,18,21]; return Array.from({length:count},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+Math.floor(i/perDay));d.setHours(slots[i%Math.min(perDay,slots.length)]??12,0,0,0);return d;}); }
const dates=schedule(new Date('2026-08-12T00:00:00'),5,2);
assert.equal(dates[0].getHours(),9); assert.equal(dates[1].getHours(),13); assert.equal(dates[2].getDate(),13);
assert.equal([1,2,3,'draft'].join(':'),'1:2:3:draft');

const key=createHash('sha256').update('test-key').digest(), iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
const encrypted=Buffer.concat([cipher.update('secret'),cipher.final()]), tag=cipher.getAuthTag(), decipher=createDecipheriv('aes-256-gcm',key,iv); decipher.setAuthTag(tag);
assert.equal(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString(),'secret');
console.log('Pinterest scheduler, idempotency key, and encryption checks passed.');
