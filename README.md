# موقع أشياد للجوال (PWA)

يقرأ `snapshot.json` من Google Drive (الذي يرفعه برنامج الديسك توب) ويعرض مراحل المعاملات وقائمتها وتفاصيلها.

## الإعداد
1. أنشئ مستودعاً عاماً على GitHub باسم `ashyad-mobile` وارفع إليه **محتويات هذا المجلد** (index.html وبقية الملفات وصور png)، ثم Settings ← Pages ← Branch: main ← Save.
   الرابط يصير: `https://USERNAME.github.io/ashyad-mobile/`
2. في Google Cloud (مشروع ashyad-sites) ← Google Auth Platform ← Clients ← Create client ← **Web application**، وفي Authorized JavaScript origins ضع `https://USERNAME.github.io` (بدون مسار). انسخ Client ID.
3. Google Auth Platform ← Data Access ← Add or remove scopes ← أضف `https://www.googleapis.com/auth/drive.readonly` و`https://www.googleapis.com/auth/drive.file` ثم Save.
   وفي Clients ← عميل الويب ← Authorized redirect URIs أضف `https://USERNAME.github.io/ashyad-mobile/`.
4. افتح `config.js` وضع الـ Client ID في `clientId` (من GitHub مباشرة: افتح الملف ← أيقونة القلم ← Commit).
5. في Drive شارك المجلد «أشياد - مزامنة» مع إيميلات الموظفين بصلاحية **Viewer**.
6. الموظف يفتح الرابط من جواله، يدخل بجوجل (إن ظهر تحذير «لم يتم التحقق»: Advanced ← Go to)، ثم «إضافة إلى الشاشة الرئيسية».

## الأقسام
- الرئيسية، مراحل المعاملات، قائمة المعاملات، طلباتي (تقديم/إرجاع تُرسَل إلى الديسك توب وتُنفَّذ هناك).
- صور المعاملات: من تفاصيل المعاملة (صور المسح 2–8، صور عامة)؛ تُرفع إلى Drive ثم يحذفها الجوال بعد أن ينزّلها الديسك توب.
- الإعدادات (زر الترس): الوضع (فاتح، شمس عالي التباين، داكن، تلقائي)، لون التطبيق، كثافة الزجاج والتمويه، الشفافية عند اللمس، حجم المحتوى، وإظهار أقسام الرئيسية.
- المخالفات والكميات: عرض فقط (وصور المخالفة تُرفع من تفاصيلها).
- الاستشاري وجدولة التطفئة: أوفلاين، ويصدّران Excel بنفس القوالب (ملفات xlsx في المجلد هي القوالب نفسها).
- الملفات: `jszip.min.js` (مكتبة ضغط) و`xlsxtools.js` (تعديل القالب والمشاركة) و`consultant.js` و`outage.js` و`photos.js` (الصور) و`settings.js` (الإعدادات) و`reports.js` (المخالفات والكميات).
