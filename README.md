# Cartoon Aziz — إضافة Stremio / Harbor

إضافة بسيطة تعرض مكتبة كرتون مستضافة على روابط Cloudflare R2 العامة. تتضمن حاليًا مسلسل **سالي** بـ48 حلقة، وتولد روابط `E1.mp4` إلى `E48.mp4` تلقائيًا.

يتضمن المشروع لوقو الإضافة وبوستر سالي داخل مجلد `public`، وتخدمهما الإضافة عبر مسار `/assets`.

## المتطلبات

- Node.js 18 أو أحدث
- روابط R2 عامة (Public Development URL أو نطاق عام مخصص)

## التشغيل المحلي

من داخل مجلد المشروع:

```bash
npm install
npm start
```

ستعمل الإضافة افتراضيًا على:

```text
http://localhost:7000/manifest.json
```

للتأكد من سلامة المشروع:

```bash
npm test
```

يمكن تغيير المنفذ هكذا:

```bash
PORT=8080 npm start
```

## التثبيت في Harbor أو Stremio

1. شغّل الإضافة على جهاز يمكن لـHarbor الوصول إليه، أو انشرها على استضافة Node.js تدعم HTTPS.
2. افتح قسم الإضافات في Harbor/Stremio واختر التثبيت بواسطة رابط Manifest.
3. ألصق رابط `manifest.json`، مثل `http://localhost:7000/manifest.json` للتشغيل على نفس الجهاز، أو `https://your-domain.example/manifest.json` بعد النشر.
4. ثبّت **Cartoon Aziz** ثم افتح الكتالوج.

> ملاحظة: إذا كان Harbor على جهاز مختلف، لا تستخدم `localhost`؛ استخدم عنوان IP للجهاز المشغّل للإضافة أو رابط HTTPS منشورًا.

## ملف البيانات `cartoons.json`

الحقل `baseUrl` هو رابط R2 الأساسي. كل عنصر داخل `cartoons` يمثل مسلسلًا:

```json
{
  "id": "sally",
  "name": "سالي",
  "folder": "سالي",
  "episodes": 48,
  "episodePrefix": "E",
  "extension": ".mp4",
  "poster": "",
  "background": ""
}
```

بهذه الإعدادات يكون رابط الحلقة الأولى تلقائيًا:

```text
https://pub-2ad8f7652233436cb957fed37d7bed31.r2.dev/%D8%B3%D8%A7%D9%84%D9%8A/E1.mp4
```

## إضافة مسلسل جديد

1. ارفع الملفات إلى مجلد جديد في R2، مثل `ريمي/E1.mp4` و`ريمي/E2.mp4`.
2. أضف عنصرًا جديدًا إلى مصفوفة `cartoons` في `cartoons.json`:

```json
{
  "id": "remi",
  "name": "ريمي",
  "description": "مسلسل ريمي.",
  "folder": "ريمي",
  "episodes": 51,
  "episodePrefix": "E",
  "extension": ".mp4",
  "poster": "https://example.com/remi-poster.jpg",
  "background": "https://example.com/remi-background.jpg",
  "releaseInfo": "1977"
}
```

3. احفظ الملف. ستقرأ الإضافة التغيير تلقائيًا عند الطلب، دون تعديل الكود أو إعادة التشغيل.

يجب أن يكون `id` فريدًا وبأحرف لاتينية دون `:`. يمكن ترك `poster` و`background` فارغين، لكن إضافة روابط صور عامة تحسن العرض.

## المسارات التي توفرها الإضافة

- `/manifest.json`
- `/catalog/series/cartoon-aziz.json`
- `/meta/series/{id}.json`
- `/stream/series/{episode-id}.json`

## تنبيه

استخدم فقط المواد التي تملك حق استضافتها ومشاركتها. يجب أن تبقى ملفات R2 قابلة للوصول العام لكي يستطيع المشغّل فتحها.
