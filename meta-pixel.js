// Meta Pixel for restaurantekipeixe.com.br. No customer PII is sent by this file.
(() => {
  const pixelId = '1152743323896193';
  if (window.__kipeixePixelReady) return;
  window.__kipeixePixelReady = true;

  !function(f,b,e,v,n,t,s) {
    if (f.fbq) return;
    n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
    t=b.createElement(e);t.async=!0;t.src=v;
    s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', pixelId);
  window.fbq('track', 'PageView');
  window.kipeixeTrack = (eventName, parameters = {}) => {
    if (typeof eventName !== 'string' || !window.fbq) return;
    window.fbq('track', eventName, parameters);
  };
})();
