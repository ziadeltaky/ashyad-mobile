# موقع أشياد للجوال (PWA — للقراءة فقط في هذه المرحلة)

يقرأ `snapshot.json` من Google Drive (الذي يرفعه برنامج الديسك توب) ويعرض مراحل المعاملات وقائمتها وتفاصيلها.

## الإعداد
1. أنشئ مستودعاً عاماً على GitHub باسم `ashyad-mobile` وارفع إليه **محتويات هذا المجلد** (index.html وبقية الملفات وصور png)، ثم Settings ← Pages ← Branch: main ← Save.
   الرابط يصير: `https://USERNAME.github.io/ashyad-mobile/`
2. في Google Cloud (مشروع ashyad-sites) ← Google Auth Platform ← Clients ← Create client ← **Web application**، وفي Authorized JavaScript origins ضع `https://USERNAME.github.io` (بدون مسار). انسخ Client ID.
3. Google Auth Platform ← Data Access ← Add or remove scopes ← أضف `https://www.googleapis.com/auth/drive.readonly` ثم Save.
4. افتح `config.js` وضع الـ Client ID في `clientId` (من GitHub مباشرة: افتح الملف ← أيقونة القلم ← Commit).
5. في Drive شارك المجلد «أشياد - مزامنة» مع إيميلات الموظفين بصلاحية **Viewer**.
6. الموظف يفتح الرابط من جواله، يدخل بجوجل (إن ظهر تحذير «لم يتم التحقق»: Advanced ← Go to)، ثم «إضافة إلى الشاشة الرئيسية».
