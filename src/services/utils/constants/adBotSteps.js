/* eslint-disable no-tabs */
export const adBotSteps = {
  main: {
    name: 'الخطوة الرئيسية',
    stepNumber: 1,
    description: 'البوت متصل',
    nextStepMessage: 'أرسل أمر "حساب رومات\nWE-AAAAAAAAA" للمتابعة',
    done: false
  },
  room: {
    name: 'اضافة حساب الرومات',
    stepNumber: 2,
    description: 'حساب الرومات متصل',
    nextStepMessage: 'أرسل أمر "تجهيز" للمتابعة',
    done: false
  },
  members: {
    name: 'تجهيز البوت',
    stepNumber: 3,
    description: 'تم تجهيز البوت',
    nextStepMessage: 'أرسل أمر "حساب اعلان" للمتابعة',
    done: false
  },
  ad: {
    name: 'اضافة حساب الاعلانات',
    stepNumber: 4,
    description: 'حساب الإعلان متصل',
    nextStepMessage: `الرجاء اختيار نمط الإعلان
		1- لارسال رسالة واحدة
		2- لارسال ثلاث رسائل`,
    done: false
  },

  adStyle: {
    name: 'نمط الرسائل',
    stepNumber: 5,
    description: 'تم إختيار نمط الإعلان بنجاح',
    nextStepMessage: 'الرجاء إرسال رسالة الإعلان',
    done: false
  },

  message: {
    name: 'رسالة الاعلان',
    stepNumber: 6,
    description: 'تم إضافة رسالة الإعلان بنجاح',
    nextStepMessage: 'أرسل أمر "تشغيل" للمتابعة',
    done: false
  },
  sending: {
    name: 'جاري إرسال الإعلانات',
    stepNumber: 7,
    description: `تم تشغيل البوت بنجاح
    جاري الإعلان`,
    nextStepMessage: 'أرسل أمر "وقف" لإيقاف البوت',
    done: false
  },
  adsSent: {
    name: 'تم إرسال الإعلانات',
    stepNumber: 8,
    description: 'تم الانتهاء والإعلان لجميع أعضاء الغرف بنجاح',
    // nextStepMessage: 'أرسل أمر "إنهاء" للمتابعة',
    done: false
  }
};
