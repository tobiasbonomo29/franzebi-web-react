/**
 * Preloader: se renderiza en el HTML inicial y un script inline lo oculta al evento load.
 * Fallbacks: (1) timeout máximo 4s, (2) sin JS no se muestra (html.no-js), (3) nunca bloquea el scroll
 * (no toca overflow del body), (4) prefers-reduced-motion sin animación (CSS).
 */
const script = `
(function(){
  var d=document.documentElement; d.classList.remove('no-js');
  var done=false;
  function hide(){ if(done) return; done=true; var p=document.getElementById('fz-preloader'); if(p){ p.classList.add('done'); setTimeout(function(){ p.remove(); }, 600); } }
  try { if (sessionStorage.getItem('fz_seen')) { hide(); return; } sessionStorage.setItem('fz_seen','1'); } catch(e) {}
  if (document.readyState === 'complete') hide(); else window.addEventListener('load', hide, { once: true });
  setTimeout(hide, 4000);
})();`;

export function Preloader() {
  return (
    <>
      <div id="fz-preloader" className="preloader" role="presentation" aria-hidden="true">
        <div className="mark">FZ</div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
