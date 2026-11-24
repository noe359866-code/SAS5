# Sonda 7: capo8play.js, playcapo.st completo y player de tvlibrehd

Fecha: 2026-11-24T15:27:47.803Z

## playcapo.st/update/capof1.php — HTTP 200 · 1215 B
```html
<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dazn Formula 1 Spain</title>
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}</style>
</head><body>
<script>fid="capof1"; v_width="100%"; v_height="100%";</script><script type="text/javascript" src="https://capo8play.com/capo.js"></script>

<script type="text/javascript" src="js/adcashcap.js"></script>

<script>
    aclib.runPop({zoneId: '11663414'});
</script>

 <!-- Histats.com  START  (aync)-->
<script type="text/javascript">var _Hasync= _Hasync|| [];
_Hasync.push(['Histats.start', '1,5035311,4,0,0,0,00010000']);
_Hasync.push(['Histats.fasi', '1']);
_Hasync.push(['Histats.track_hits', '']);
(function() {
var hs = document.createElement('script'); hs.type = 'text/javascript'; hs.async = true;
hs.src = ('//s10.histats.com/js15_as.js');
(document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(hs);
})();</script>
<noscript><a href="/" target="_blank"><img  src="//sstatic1.histats.com/0.gif?5035311&101" alt="site analysis" border="0"></a></noscript>
<!-- Histats.com  END  --></body></html>
```
## capo8play.com/capo.js — HTTP 200 · 557 B · application/javascript
```js
var isMobile = /android|ipad|ipod|iphone|blackberry|iemobile|opera mini/i.test(navigator.userAgent);
var embedded = isMobile ? "mobile" : "desktop";
var PlaySize = (v_height == "100%") ? 'style="overflow:hidden;height:100%;width:100%"' : '';
document.write('<ifr'+'ame src="https://capo8play.com/capo.php?player='+ embedded +'&live='+ fid +'" '+PlaySize+' width='+ v_width +' height='+ v_height +' scrolling="no" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></ifr'+'ame>');
```
## tvlibrehd espn — HTTP 200 · 23892 B
## tvlibrehd 54c4624ecf_44.js — HTTP 200 · 13164 B
```js
window.FontAwesomeKitConfig = {"id":60923587,"version":"6.6.0","token":"54c4624ecf","method":"css","baseUrl":"https://ka-f.fontawesome.com","license":"free","asyncLoading":{"enabled":false},"autoA11y":{"enabled":true},"baseUrlKit":"https://kit.fontawesome.com","detectConflictsUntil":null,"iconUploads":{},"minify":{"enabled":true},"v4FontFaceShim":{"enabled":true},"v4shim":{"enabled":true},"v5FontFaceShim":{"enabled":true}};
!function(t){"function"==typeof define&&define.amd?define("kit-loader",t):t()}((function(){"use strict";function t(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter((function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable}))),n.push.apply(n,r)}return n}function e(e){for(var n=1;n<arguments.length;n++){var o=null!=arguments[n]?arguments[n]:{};n%2?t(Object(o),!0).forEach((function(t){r(e,t,o[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(o)):t(Object(o)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(o,t))}))}return e}function n(t){return(n="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t})(t)}function r(t,e,n){return(e=function(t){var e=function(t,e){if("object"!=typeof t||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,e||"default");if("object"!=typeof r)return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==typeof e?e:String(e)}(e))in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}function o(t,e){return function(t){if(Array.isArray(t))return t}(t)||function(t,e){var n=null==t?null:"undefined"!=typeof Symbol&&t[Symbol.iterator]||t["@@iterator"];if(null!=n){var r,o,i,a,c=[],u=!0,s=!1;try{if(i=(n=n.call(t)).next,0===e){if(Object(n)!==n)return;u=!1}else for(;!(u=(r=i.call(n)).done)&&(c.push(r.value),c.length!==e);u=!0);}catch(t){s=!0,o=t}finally{try{if(!u&&null!=n.return&&(a=n.return(),Object(a)!==a))return}finally{if(s)throw o}}return c}}(t,e)||i(t,e)||function(){throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}function i(t,e){if(t){if("string"==typeof t)return a(t,
```
