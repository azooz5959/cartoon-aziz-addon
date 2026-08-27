<div align="center">
  <img src="public/app-logo-v2.png" width="170" alt="Cartoon Aziz">
  <h1>Cartoon Aziz</h1>
  <p><strong> الكرتون الكلاسيكي </strong></p>
  <p>إضافة لـHarbor وStremio، تعمل عبر Cloudflare R2.</p>
  <p><a href="https://cartoon-aziz-addon.onrender.com/configure"><strong>إعداد الإضافة</strong></a> · <a href="https://cartoon-aziz-addon.onrender.com/manifest.json"><strong>Manifest</strong></a> · <a href="https://cartoon-aziz-addon.onrender.com"><strong>صفحة الإضافة</strong></a></p>
</div>

## التثبيت في Harbor

انسخ الرابط التالي إلى خانة Manifest داخل Harbor:

```text
https://cartoon-aziz-addon.onrender.com/manifest.json
```

قد يحتاج أول فتح إلى قرابة دقيقة لأن الاستضافة المجانية تدخل وضع السكون عند عدم الاستخدام.

## إعداد Cloudflare R2 وتقليل استهلاك Render

الفيديو يُرسل إلى Stremio كرابط R2 مباشر ولا يمر عبر Render. ارفع
`public/app-logo-v2.png` إلى مجلد مثل `assets/` في R2، ثم أضف متغير البيئة:

```text
ASSET_BASE_URL=https://YOUR-R2-PUBLIC-DOMAIN/assets
```

إذا لم تضبطه، تستخدم الإضافة تلقائيًا `baseUrl/assets` من `cartoons.json`.
اترك `CHECK_STREAMS` غير مضبوط (أو `false`) لمنع فحوص `HEAD` الكثيرة. لا تضبطه
على `true` إلا عند الحاجة لفحص وجود الحلقات؛ ويمكن عندها تحديد مدة التخزين عبر
`STREAM_CHECK_TTL_MS` (الافتراضي 6 ساعات).

إعداد `stremioAddonsConfig` والـclaim محفوظ داخل الـmanifest كما هو.

## دعم المشروع

بدعمكم نستمر ونقدم الأفضل ❤️

[ادعم Cartoon Aziz عبر Ko-fi](https://ko-fi.com/59azooz)
