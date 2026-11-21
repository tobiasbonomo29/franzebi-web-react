/*
 * Franzebi — comportamiento de tienda sobre el markup heredado de WooCommerce/Elementor.
 * Reemplaza lo que hacían los scripts de Woo (add-to-cart AJAX, cart fragments, carrito, cuenta)
 * hablando con la API propia. Precios, stock y reglas se calculan SIEMPRE en el servidor.
 */
(function () {
  "use strict";
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function api(url, body) {
    return fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.__ok = r.ok; return j; });
    });
  }

  /* ---------- Mini-carrito del header (equivalente a los "cart fragments" de Woo) ---------- */
  function applyFragments(f) {
    if (!f || f.count == null) return;
    $$(".elementor-button-icon-qty").forEach(function (el) { el.textContent = String(f.count); el.setAttribute("data-counter", String(f.count)); });
    $$(".elementor-menu-cart__toggle_button .elementor-button-text").forEach(function (el) { el.innerHTML = f.subtotal; });
    $$(".vamtam-elementor-menu-cart__header .item-count").forEach(function (el) { el.textContent = "(" + f.count + ")"; });
    $$(".widget_shopping_cart_content").forEach(function (el) { el.innerHTML = f.miniCart; });
    document.body.classList.toggle("vamtam-wc-cart-empty", f.count === 0);
    $$(".elementor-menu-cart__wrapper .elementor-menu-cart__toggle_wrapper").forEach(function (el) { el.classList.toggle("elementor-menu-cart--empty-indicator-hide", f.count === 0); });
  }
  // Cada modificación invalida lecturas en vuelo (evita que un GET viejo pise el contador tras un POST)
  var cartGen = 0;
  function refreshCart() {
    var g = cartGen;
    return api("/api/cart/fragments/").then(function (f) { if (g === cartGen) applyFragments(f); });
  }

  function notice(text, kind) {
    var wrap = document.querySelector(".woocommerce-notices-wrapper") || document.getElementById("main");
    if (!wrap) { if (text) window.alert(text); return; }
    var div = document.createElement("div");
    div.className = kind === "error" ? "woocommerce-error" : "woocommerce-message";
    div.setAttribute("role", "alert");
    div.textContent = text;
    wrap.prepend(div);
    setTimeout(function () { div.remove(); }, 8000);
  }

  function addToCart(sku, qty, button) {
    cartGen++;
    if (button) { button.classList.remove("added"); button.classList.add("loading"); }
    return api("/api/cart/fragments/", { action: "add", sku: sku, quantity: qty }).then(function (j) {
      if (button) button.classList.remove("loading");
      if (!j.__ok) { notice(j.error || "No pudimos agregar el producto.", "error"); return; }
      applyFragments(j);
      if (j.notice) notice(j.notice, "error");
      if (button) {
        button.classList.add("added");
        if (!button.parentNode.querySelector(".added_to_cart")) {
          var a = document.createElement("a");
          a.href = "/carrito/";
          a.className = "added_to_cart wc-forward";
          a.title = "Ver carrito";
          a.textContent = "Ver carrito";
          button.insertAdjacentElement("afterend", a);
        }
      }
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    // Botón "Añadir al carrito" de las grillas
    var btn = t.closest("a.add_to_cart_button[data-product_sku]");
    if (btn) {
      e.preventDefault();
      var li = btn.closest("li.product");
      var input = li && li.querySelector(".custom-quantity-wrapper .qty-input");
      var qty = Math.max(1, parseInt((input && input.value) || btn.getAttribute("data-quantity") || "1", 10) || 1);
      addToCart(btn.getAttribute("data-product_sku"), qty, btn);
      return;
    }

    // Selector de cantidad (+ / –) del snippet del sitio
    var q = t.closest(".quantity-selector .qty-btn");
    if (q) {
      e.preventDefault();
      var inp = q.parentNode.querySelector(".qty-input");
      var max = parseInt(inp.getAttribute("max") || "999", 10);
      var v = parseInt(inp.value || "1", 10) || 1;
      v = q.classList.contains("plus") ? Math.min(max, v + 1) : Math.max(1, v - 1);
      inp.value = String(v);
      var b = q.closest("li.product") && q.closest("li.product").querySelector(".add_to_cart_button");
      if (b) b.setAttribute("data-quantity", String(v));
      return;
    }

    // Quitar del mini-carrito
    var rm = t.closest(".remove_from_cart_button[data-product_sku]");
    if (rm) {
      e.preventDefault();
      cartGen++;
      api("/api/cart/fragments/", { action: "set", sku: rm.getAttribute("data-product_sku"), quantity: 0 }).then(function (j) {
        applyFragments(j);
        if (document.body.classList.contains("woocommerce-cart")) location.reload();
      });
      return;
    }

    // Quitar en /carrito/
    var rc = t.closest("form[data-fz-cart-form] a.remove[data-product_sku]");
    if (rc) {
      e.preventDefault();
      api("/api/cart/fragments/", { action: "set", sku: rc.getAttribute("data-product_sku"), quantity: 0 }).then(function () { location.reload(); });
      return;
    }

    // Toggle "Rango de precios"
    var head = t.closest("[data-fz-price-filter] .bapf_head");
    if (head) {
      var box = head.parentNode;
      var body = box.querySelector(".bapf_body");
      var open = body.style.display === "none";
      body.style.display = open ? "" : "none";
      box.classList.toggle("bapf_ocolaps", !open);
      var ico = head.querySelector(".bapf_colaps_smb");
      if (ico) { ico.classList.toggle("fa-chevron-down", !open); ico.classList.toggle("fa-chevron-up", open); }
      return;
    }

    // Menú "Ordenar" del archivo
    var ord = t.closest(".woocommerce-ordering__button");
    if (ord) {
      ord.parentNode.classList.toggle("active");
      return;
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t instanceof HTMLInputElement && t.classList.contains("qty-input")) {
      var b = t.closest("li.product") && t.closest("li.product").querySelector(".add_to_cart_button");
      if (b) b.setAttribute("data-quantity", t.value);
    }
  });

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!(f instanceof HTMLFormElement)) return;

    // Ficha de producto
    if (f.hasAttribute("data-fz-add-form")) {
      e.preventDefault();
      var qty = parseInt((f.querySelector("input.qty") || {}).value || "1", 10) || 1;
      addToCart(f.getAttribute("data-sku"), qty, f.querySelector(".single_add_to_cart_button"));
      return;
    }

    // /carrito/ "Actualizar carrito"
    if (f.hasAttribute("data-fz-cart-form")) {
      e.preventDefault();
      var jobs = $$("input.qty[data-sku]", f).map(function (i) {
        return api("/api/cart/fragments/", { action: "set", sku: i.getAttribute("data-sku"), quantity: Math.max(0, parseInt(i.value || "0", 10) || 0) });
      });
      Promise.all(jobs).then(function () { location.reload(); });
      return;
    }

    // Contacto (form de Elementor)
    if (f.hasAttribute("data-fz-contact")) {
      e.preventDefault();
      var g = function (n) { var el = f.querySelector('[name="form_fields[' + n + ']"]'); return el ? el.value : ""; };
      var btn = f.querySelector('button[type="submit"]');
      if (btn) btn.classList.add("elementor-form-waiting");
      $$(".elementor-message", f).forEach(function (m) { m.remove(); });
      api("/api/contacto/", { name: g("name"), email: g("email"), message: g("message"), honeypot: g("field_193af41") || undefined }).then(function (j) {
        if (btn) btn.classList.remove("elementor-form-waiting");
        var m = document.createElement("div");
        m.className = "elementor-message " + (j.success ? "elementor-message-success" : "elementor-message-danger");
        m.setAttribute("role", "alert");
        m.textContent = j.message || (j.success ? "El formulario se envió correctamente." : "Ha ocurrido un error.");
        f.appendChild(m);
        if (j.success) f.reset();
      });
      return;
    }

    // Mi cuenta: login / registro / olvidé mi contraseña
    var mode = f.classList.contains("woocommerce-form-login") ? "login" : f.classList.contains("woocommerce-form-register") ? "register" : f.classList.contains("lost_reset_password") ? "lost-password" : null;
    if (mode) {
      e.preventDefault();
      var data = {};
      $$("input", f).forEach(function (i) { if (i.name && i.type !== "checkbox") data[i.name] = i.value; });
      var sb = f.querySelector('button[type="submit"]');
      if (sb) sb.disabled = true;
      api("/api/auth/" + mode + "/", data).then(function (j) {
        if (sb) sb.disabled = false;
        if (j.__ok && j.redirect) { location.href = j.redirect; return; }
        notice(j.message || (j.__ok ? "Listo." : "No pudimos completar la operación."), j.__ok ? "message" : "error");
        if (j.__ok) f.reset();
      });
    }
  });

  // Buscador: siempre busca productos (misma URL que WP: /?s=term&post_type=product)
  $$("form.dgwt-wcas-search-form").forEach(function (f) { f.setAttribute("action", "/"); });

  // Botón "mostrar contraseña" (lo agregaba woocommerce.js)
  $$(".woocommerce form .woocommerce-Input[type=password], .woocommerce form input[type=password]").forEach(function (inp) {
    if (inp.parentNode.classList.contains("password-input")) return;
    var wrap = document.createElement("span");
    wrap.className = "password-input";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var b = document.createElement("button");
    b.type = "button";
    b.className = "show-password-input";
    b.setAttribute("aria-label", "Mostrar contraseña");
    b.addEventListener("click", function () {
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      b.classList.toggle("display-password", show);
      b.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    });
    wrap.appendChild(b);
  });

  // Ítem activo del menú (WP lo marcaba server-side con current-menu-item)
  var slash = function (s) { return s.charAt(s.length - 1) === "/" ? s : s + "/"; };
  var here = slash(location.pathname);
  $$(".elementor-nav-menu a").forEach(function (a) {
    if (slash(a.getAttribute("href") || "") === here) {
      a.classList.add("elementor-item-active");
      if (a.parentNode) a.parentNode.classList.add("current-menu-item");
    }
  });

  refreshCart();
})();
