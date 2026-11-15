/** 業主還沒提供的資料：網頁上顯示「待補」標籤，上線前要補齊 */
export function Todo({ label = "待補" }: { label?: string }) {
  return <span className="todo">{label}</span>;
}

export function orTodo(v: string | number | null | undefined, suffix = "") {
  return v === null || v === undefined || v === "" ? <Todo /> : <>{v}{suffix}</>;
}
