-- Higiene: las funciones de trigger no necesitan EXECUTE para dispararse (el privilegio se verifica al crear el trigger).
-- Se les quita a anon/authenticated para que no aparezcan como invocables vía API.
-- is_staff / is_admin / product_in_hidden_category / current_role_id quedan: las usan las políticas RLS en el contexto del usuario.
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.enqueue_order_event() from public, anon, authenticated;
revoke execute on function public.guard_role_change() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.propagate_category_visibility() from public, anon, authenticated;
revoke execute on function public.prevent_sku_change() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
