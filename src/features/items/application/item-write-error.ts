const ITEM_WRITE_REJECTION_MESSAGES = Object.freeze({
  invalid_categories:
    "選択されたカテゴリが存在しないか、このユーザーには利用できません。",
  calculated_values_out_of_range:
    "入力値から算出される費用または利益が、保存可能な範囲を超えています。",
  image_upload_expired:
    "画像アップロードの有効期限が切れました。画像を選択し直してください。",
  image_upload_consumed:
    "画像アップロードは既に使用されています。画像を選択し直してください。",
  image_upload_incomplete:
    "画像のアップロードが完了していません。もう一度お試しください。",
  invalid_image_upload:
    "アップロードされた画像の形式または容量が不正です。画像を選択し直してください。",
} as const);

export type ItemWriteRejectionCode =
  keyof typeof ITEM_WRITE_REJECTION_MESSAGES;

export class ItemWriteRejectedError extends Error {
  constructor(readonly code: ItemWriteRejectionCode) {
    super(ITEM_WRITE_REJECTION_MESSAGES[code]);
    this.name = "ItemWriteRejectedError";
  }
}
