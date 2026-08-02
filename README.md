<div align="center">
  <img src="public/app-logo-v2.png" width="170" alt="Cartoon Aziz">
  <h1>Cartoon Aziz</h1>
  <p><strong>عالم الكرتون العربي الكلاسيكي — مكتبة عزيز الخاصة</strong></p>
  <p>إضافة احترافية لـHarbor وStremio، تعمل عبر Cloudflare R2.</p>
  <p><a href="https://cartoon-aziz-addon.onrender.com/configure"><strong>إعداد الإضافة</strong></a> · <a href="https://cartoon-aziz-addon.onrender.com/manifest.json"><strong>Manifest</strong></a> · <a href="https://cartoon-aziz-addon.onrender.com"><strong>صفحة الإضافة</strong></a></p>
</div>

---

## المتوفر حاليًا

| المسلسل | السنة | الجودة | الحلقات | الأقسام |
|---|---:|---:|---:|---|
| سالي | 1985 | 1080p | 48 | كلاسيكيات، أطفال، مغامرات |

## المزايا

- بحث عربي داخل المكتبة.
- أقسام مستقلة للكلاسيكيات والمغامرات والأطفال.
- بوستر وخلفية وصور حلقات قابلة للتخصيص لكل مسلسل.
- وصف وسنة وتصنيف ومدة وجودة ولغة.
- ترتيب الحلقات حسب الموسم ورقم الحلقة.
- فحص روابط R2 وإخفاء الحلقة عند رجوع `404`.
- إضافة مسلسلات جديدة من `cartoons.json` دون تعديل الكود.
- صفحة ترحيبية تعرض حالة الإضافة وعدد المسلسلات والحلقات.
- واجهة إعداد ونسخ رابط Manifest.

## التثبيت في Harbor

انسخ الرابط التالي إلى خانة Manifest داخل Harbor:

```text
https://cartoon-aziz-addon.onrender.com/manifest.json
```

قد يحتاج أول فتح إلى قرابة دقيقة لأن الاستضافة المجانية تدخل وضع السكون عند عدم الاستخدام.

## إضافة مسلسل جديد

ارفع حلقات المسلسل إلى مجلد عام في R2، ثم أضف عنصرًا إلى مصفوفة `cartoons` داخل `cartoons.json`:

```json
{
  "id": "remi",
  "name": "ريمي",
  "description": "مسلسل ريمي الكلاسيكي.",
  "year": 1977,
  "runtime": "24 دقيقة",
  "quality": "1080p",
  "language": "العربية",
  "genres": ["دراما", "مغامرات", "عائلي"],
  "categories": ["classics", "kids", "adventures"],
  "folder": "ريمي",
  "episodes": 51,
  "season": 1,
  "episodePrefix": "E",
  "extension": ".mp4",
  "poster": "https://example.com/remi-poster.png",
  "background": "https://example.com/remi-background.png",
  "episodeThumbnail": "https://example.com/remi-episode.png"
}
```

لصور منفصلة لكل حلقة يمكن استخدام قالب يحتوي `{episode}`:

```json
"episodeThumbnailTemplate": "https://example.com/remi/E{episode}.jpg"
```

أو تخصيص حلقات معينة:

```json
"episodeThumbnails": {
  "1": "https://example.com/remi/episode-1.jpg",
  "2": "https://example.com/remi/episode-2.jpg"
}
```

## التشغيل المحلي

يتطلب Node.js 18 أو أحدث:

```bash
npm install
npm start
```

ثم افتح `http://localhost:7000`. للاختبار:

```bash
npm test
```

## تنبيه

استخدم فقط المواد التي تملك حق استضافتها ومشاركتها.
