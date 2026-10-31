/* Pathway AI: tiny standalone runtime for the page templates.
   Renders the <x-dc> template with the page's Component class (state, handlers, loops, conditions). */
(function () {
  'use strict';
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var PURE = /^\{\{\s*([^}]*?)\s*\}\}$/;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (m, p) {
      var v = lookup(p, scope);
      return v == null || v === false ? '' : String(v);
    });
  }
  function evalAttr(val, scope) {
    var m = PURE.exec(val || '');
    return m ? lookup(m[1], scope) : val;
  }

  function build(node, scope) {
    if (node.nodeType === 3) {
      var tv = node.nodeValue;
      return [document.createTextNode(tv.indexOf('{{') > -1 ? interp(tv, scope) : tv)];
    }
    if (node.nodeType !== 1) return [];
    var tag = node.localName;
    var out = [];
    if (tag === 'sc-for') {
      var list = evalAttr(node.getAttribute('list'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      list.forEach(function (item, i) {
        var s = Object.create(scope);
        s[as] = item;
        s.$index = i;
        node.childNodes.forEach(function (c) {
          build(c, s).forEach(function (n) { out.push(n); });
        });
      });
      return out;
    }
    if (tag === 'sc-if') {
      if (!evalAttr(node.getAttribute('value'), scope)) return out;
      node.childNodes.forEach(function (c) {
        build(c, scope).forEach(function (n) { out.push(n); });
      });
      return out;
    }
    var el = document.createElementNS(node.namespaceURI, node.localName);
    Array.prototype.forEach.call(node.attributes, function (a) {
      var name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) return;
      var m = PURE.exec(val);
      if (name.length > 2 && name.indexOf('on') === 0 && m) {
        var fn = lookup(m[1], scope);
        if (typeof fn === 'function') {
          (el.__on || (el.__on = {}))[name.slice(2)] = fn;
        }
        return;
      }
      var res;
      if (m) {
        var v = lookup(m[1], scope);
        if (v == null || v === false) return;
        res = String(v);
      } else if (val.indexOf('{{') > -1) {
        res = interp(val, scope);
      } else {
        res = val;
      }
      el.setAttribute(name, res);
    });
    node.childNodes.forEach(function (c) {
      build(c, scope).forEach(function (n) { el.appendChild(n); });
    });
    return [el];
  }

  function morphChildren(oldP, newP) {
    var oc = Array.prototype.slice.call(oldP.childNodes);
    var nc = Array.prototype.slice.call(newP.childNodes);
    var n = Math.min(oc.length, nc.length);
    for (var i = 0; i < n; i++) {
      var o = oc[i], w = nc[i];
      if (o.nodeType === 3 && w.nodeType === 3) {
        if (o.nodeValue !== w.nodeValue) o.nodeValue = w.nodeValue;
      } else if (o.nodeType === 1 && w.nodeType === 1 && o.nodeName === w.nodeName && o.namespaceURI === w.namespaceURI) {
        Array.prototype.slice.call(o.attributes).forEach(function (a) {
          if (!w.hasAttribute(a.name)) o.removeAttribute(a.name);
        });
        Array.prototype.forEach.call(w.attributes, function (a) {
          if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
        });
        o.__on = w.__on;
        morphChildren(o, w);
      } else {
        oldP.replaceChild(w, o);
      }
    }
    for (var j = n; j < oc.length; j++) oldP.removeChild(oc[j]);
    for (var k = n; k < nc.length; k++) oldP.appendChild(nc[k]);
  }

  var host, tpl, inst, pending = false, mounted = false;

  function vals() { return inst.renderVals() || {}; }
  function renderNodes() {
    var scope = vals();
    var wrap = document.createElement('div');
    tpl.forEach(function (n) {
      build(n, scope).forEach(function (x) { wrap.appendChild(x); });
    });
    return wrap;
  }
  function update() {
    pending = false;
    morphChildren(host, renderNodes());
  }
  function schedule() {
    if (pending || !mounted) return;
    pending = true;
    Promise.resolve().then(update);
  }

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (p) {
    var patch = typeof p === 'function' ? p(this.state) : p;
    this.state = Object.assign({}, this.state, patch);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function boot() {
    host = document.querySelector('x-dc');
    if (!host) return;
    var helmet = host.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (c) { document.head.appendChild(c); });
      helmet.parentNode.removeChild(helmet);
    }
    host.style.display = 'contents';
    var scriptEl = document.querySelector('script[type="text/x-dc"]');
    var Component = new Function('DCLogic', scriptEl.textContent + '\nreturn Component;')(DCLogic);
    inst = new Component({});
    tpl = Array.prototype.slice.call(host.childNodes);
    host.textContent = '';
    var first = renderNodes();
    while (first.firstChild) host.appendChild(first.firstChild);
    mounted = true;
    ['click', 'keydown'].forEach(function (type) {
      host.addEventListener(type, function (e) {
        var el = e.target;
        while (el && el !== host) {
          if (el.__on && el.__on[type]) { el.__on[type](e); return; }
          el = el.parentNode;
        }
      });
    });
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
