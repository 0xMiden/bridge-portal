import { redirect } from "next/navigation";

export default function ArcPage() {
  redirect("/?provider=xreserve&mode=receive");
}
