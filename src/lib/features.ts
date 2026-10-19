// 功能開關（對應 F 版規格的四層開關；此處為展示用的場站層設定）。
// 正式版改由 site_feature_settings 資料表提供。
export const features = {
  /** 現金繳費機：第一站無人化、無現金，先關閉並在畫面保留位置。 */
  cashKiosk: process.env.NEXT_PUBLIC_FEATURE_CASH_KIOSK === "true",
};
