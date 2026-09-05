import { magicBotSteps } from '../../constants/magicBotSteps.js';
import { userMessages } from '../../constants/userMessages.js';

export function buildNextRoomAccountMessage (accountNumber, roomCount) {
  return `تم اتصال حساب الرومات رقم ( ${accountNumber} ) بنجاح
عدد الرومات في هذا الحساب: ${roomCount}
${userMessages.sendNextRoomABotToken}`;
}

export function buildRoomAccountsCompleteMessage (accountCount, totalRoomCount) {
  return `${magicBotSteps.room.description}
إجمالي حسابات الرومات: ${accountCount}
إجمالي عدد الرومات: ${totalRoomCount}
${magicBotSteps.room.nextStepMessage}`;
}
