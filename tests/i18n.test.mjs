import test from 'node:test';
import assert from 'node:assert/strict';
import {getLanguage,getLocale,localizeMessage,normalizeLanguage,registerMessages,resolveLocale,setLanguage,t} from '../i18n.js';
import '../i18n-content.js';

test('normalizes explicit language preferences and browser variants',()=>{
  assert.equal(normalizeLanguage('zh-TW'),'zh-CN');
  assert.equal(normalizeLanguage('en-US'),'en');
  assert.equal(normalizeLanguage('fr-FR'),'auto');
  assert.equal(resolveLocale('auto',['zh-TW','en-US']),'zh-CN');
  assert.equal(resolveLocale('auto',['fr-FR']),'en');
  assert.equal(resolveLocale('auto',['fr-FR','zh-CN']),'en');
  assert.equal(resolveLocale('en',['zh-CN']),'en');
});

test('translates registered UI messages without changing titles',()=>{
  setLanguage('en');
  assert.equal(t('评分镜片'),'Score Lens');
  assert.equal(t('{title}：{badge}。点击查看匹配、来源及纠错方式',{title:'Cash $& Carry',badge:'IMDb 8.0'}),'Cash $& Carry: IMDb 8.0. Click to view the match, sources, and correction options');
  assert.equal(t('查询时间：{date}',{date:'Room {year}'}),'Checked: Room {year}');
  assert.equal(localizeMessage('Breaking Bad'),'Breaking Bad');
  assert.equal(localizeMessage('服务返回 HTTP 503'),'Service returned HTTP 503');
  setLanguage('zh-CN');
  assert.equal(localizeMessage('Cinemeta HTTP 503'),'Cinemeta 返回 HTTP 503');
  assert.equal(t('评分镜片'),'评分镜片');
});

test('language preference is separate from resolved locale',()=>{
  assert.equal(setLanguage('auto',['zh-CN']),'zh-CN');
  assert.equal(getLanguage(),'auto');
  assert.equal(getLocale(),'zh-CN');
  assert.equal(setLanguage('en',['zh-CN']),'en');
  assert.equal(getLanguage(),'en');
  assert.equal(getLocale(),'en');
});

test('catalog registration supports explicit bilingual values for extension-owned additions',()=>{
  registerMessages({'测试消息':{en:'Test message','zh-CN':'测试消息'}});
  setLanguage('en'); assert.equal(t('测试消息'),'Test message');
  setLanguage('zh-CN'); assert.equal(t('测试消息'),'测试消息');
});
