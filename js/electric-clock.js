/*!
 * 电子钟（hexo-butterfly-clock-anzhiyu）本地修复版
 *
 * 原版 clock.min.js 依赖的两个接口已经不可用，这里做了替换与容错：
 *   1. IP 定位接口 api.nsmao.net 域名已失效 -> 改用 https://api.ipapi.is/
 *   2. 和风天气沿用插件内置的默认 key（属于插件作者，已返回 403）
 *      -> 未配置自己的 key 时不再发起请求，控制台不再报错
 *   3. 天气获取失败时依然正常渲染时钟，不会一直卡在 loading 动画
 *
 * 配置项仍由 _config.butterfly.yml 的 electric_clock 段注入为全局变量：
 *   qweather_key / qweather_api_host / clock_rectangle / clock_default_rectangle_enable
 */

(function () {
  "use strict";

  /* 插件内置的默认天气 key，已失效（403），检测到即视为「未配置」 */
  var BUILTIN_QWEATHER_KEY = "b16a1fa0e63c46a4b8f28abfb06ae3fe";
  /* 插件内置的默认天气 API Host（属于插件作者），不再沿用 */
  var BUILTIN_QWEATHER_HOST = "nj6r6pm8pt.re.qweatherapi.com";
  /* 免费 IP 定位接口，返回 { city, lat, lon, country, ... } */
  var IP_LOCATION_API = "https://api.ipapi.is/";
  var DEFAULT_CITY = "长沙市";
  var DEFAULT_RECTANGLE = "112.6534116,27.96920845";
  var DEFAULT_QWEATHER_HOST = "devapi.qweather.com";

  /* 天气图标配色（沿用原版规则，修正了 901 的多余分号） */
  var ICON_COLORS = {
    "#fdcc45": ["100"],
    "#fe6976": ["101"],
    "#fe7f5b": ["102", "103"],
    "#2152d1": ["104", "150", "151", "152", "153", "154", "800", "801", "802", "803", "804", "805", "806", "807"],
    "#49b1f5": ["300", "301", "305", "306", "307", "308", "309", "310", "311", "312", "313", "314", "315", "316", "317", "318", "350", "351", "399"],
    "#fdcc46": ["302", "303", "304"],
    "#a3c2dc": ["400", "401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "456", "457", "499"],
    "#97acba": ["500", "501", "502", "503", "504", "507", "508", "509", "510", "511", "512", "513", "514", "515"],
    red: ["900", "999"],
    "#179fff": ["901"]
  };

  var iconColorMap = (function () {
    var map = {};
    Object.keys(ICON_COLORS).forEach(function (color) {
      ICON_COLORS[color].forEach(function (code) {
        map[code] = color;
      });
    });
    return map;
  })();

  function iconColor(icon) {
    return iconColorMap[String(icon || "")] || "#000";
  }

  /* ---------- 工具函数 ---------- */

  function readGlobal(name) {
    if (typeof window !== "undefined" && window[name] !== undefined && window[name] !== null && window[name] !== "") {
      return String(window[name]);
    }
    return "";
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function zeroPadding(num, digit) {
    var zero = "";
    for (var i = 0; i < digit; i++) zero += "0";
    return (zero + num).slice(-digit);
  }

  /* ---------- 和风天气配置 ---------- */

  function getWeatherKey() {
    var key = readGlobal("qweather_key");
    if (!key || key === BUILTIN_QWEATHER_KEY) return "";
    return key;
  }

  function getWeatherHost() {
    var host = readGlobal("qweather_api_host");
    if (!host || host === BUILTIN_QWEATHER_HOST) return DEFAULT_QWEATHER_HOST;
    return host;
  }

  /* ---------- 渲染 ---------- */

  /* 计时器同步挂在 window 上，保证 pjax 重复注入时不会残留多个计时器 */
  function setClockTimer(id) {
    window.__hexoElectricClockTimer = id;
  }

  function clearClockTimer() {
    if (window.__hexoElectricClockTimer) {
      clearInterval(window.__hexoElectricClockTimer);
      window.__hexoElectricClockTimer = null;
    }
  }

  function renderClock(weather, city) {
    var clockBox = document.getElementById("hexo_electric_clock");
    if (!clockBox) return;

    var now = (weather && weather.now) || {};
    var hasWeather = !!(now.icon || now.text);

    var weatherHtml = "";
    if (hasWeather) {
      weatherHtml =
        '<i class="qi-' + escapeHtml(now.icon) + '-fill" style="color: ' + iconColor(now.icon) + '"></i> ' +
        escapeHtml(now.text) +
        (now.temp !== undefined && now.temp !== null && now.temp !== "" ? " <span>" + escapeHtml(now.temp) + "</span> ℃" : "");
    }
    var humidityHtml = now.humidity ? "💧 " + escapeHtml(now.humidity) + "%" : "";
    var windHtml = now.windDir ? '<i class="qi-gale"></i> ' + escapeHtml(now.windDir) : "";

    clockBox.innerHTML =
      '<div class="clock-row">' +
      '<span id="card-clock-clockdate" class="card-clock-clockdate"></span>' +
      '<span class="card-clock-weather">' + weatherHtml + "</span>" +
      '<span class="card-clock-humidity">' + humidityHtml + "</span>" +
      "</div>" +
      '<div class="clock-row">' +
      '<span id="card-clock-time" class="card-clock-time"></span>' +
      "</div>" +
      '<div class="clock-row">' +
      '<span class="card-clock-windDir">' + windHtml + "</span>" +
      '<span class="card-clock-location">' + escapeHtml(city || DEFAULT_CITY) + "</span>" +
      '<span id="card-clock-dackorlight" class="card-clock-dackorlight"></span>' +
      "</div>";

    var week = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    function updateTime() {
      var timeDom = document.getElementById("card-clock-time");
      if (!timeDom) {
        /* 元素已随页面切换被移除，停止计时，等待下次初始化 */
        clearClockTimer();
        return;
      }
      var cd = new Date();
      timeDom.innerHTML =
        zeroPadding(cd.getHours(), 2) + ":" + zeroPadding(cd.getMinutes(), 2) + ":" + zeroPadding(cd.getSeconds(), 2);

      var dateDom = document.getElementById("card-clock-clockdate");
      if (dateDom) {
        dateDom.innerHTML =
          zeroPadding(cd.getFullYear(), 4) +
          "-" +
          zeroPadding(cd.getMonth() + 1, 2) +
          "-" +
          zeroPadding(cd.getDate(), 2) +
          " " +
          week[cd.getDay()];
      }

      var apDom = document.getElementById("card-clock-dackorlight");
      if (apDom) {
        var hour = cd.getHours();
        apDom.innerHTML = hour > 12 ? hour - 12 + " P M" : hour + " A M";
      }
    }

    /* pjax 切换页面后避免重复计时 */
    clearClockTimer();
    setClockTimer(setInterval(updateTime, 1000));
    updateTime();
  }

  /* ---------- 数据获取 ---------- */

  var finished = false;

  function finish(weather, city) {
    if (finished) return;
    finished = true;
    renderClock(weather, city);
  }

  function fetchWeather(location, city) {
    var key = getWeatherKey();
    if (!key) {
      /* 没有配置自己的天气 key，直接渲染时钟，避免无效请求报错 */
      finish(null, city);
      return;
    }
    fetch("https://" + getWeatherHost() + "/v7/weather/now?location=" + encodeURIComponent(location) + "&key=" + encodeURIComponent(key))
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && String(data.code) === "200") {
          finish(data, city);
        } else {
          finish(null, city);
        }
      })
      .catch(function (err) {
        console.warn("[电子钟] 天气获取失败：", err && err.message ? err.message : err);
        finish(null, city);
      });
  }

  function initClock() {
    var rectangle = readGlobal("clock_rectangle") || DEFAULT_RECTANGLE;

    /* 未配置天气 key：不发起任何网络请求，只显示时间与日期 */
    if (!getWeatherKey()) {
      finish(null, DEFAULT_CITY);
      return;
    }

    /* 固定坐标模式，无需 IP 定位 */
    if (readGlobal("clock_default_rectangle_enable") === "true") {
      fetchWeather(rectangle, DEFAULT_CITY);
      return;
    }

    /* 先 IP 定位，失败则回退到配置的固定坐标 */
    fetch(IP_LOCATION_API)
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var city = (data && data.city) || DEFAULT_CITY;
        var location = rectangle;
        if (data && data.lon && data.lat) {
          location = data.lon + "," + data.lat;
        }
        fetchWeather(location, city);
      })
      .catch(function (err) {
        console.warn("[电子钟] IP 定位失败，改用默认坐标：", err && err.message ? err.message : err);
        fetchWeather(rectangle, DEFAULT_CITY);
      });
  }

  initClock();
})();
