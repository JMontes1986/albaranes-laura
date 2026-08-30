insert into public.component_catalog(code,description) values
('GRPL','GLOBULOS R. POBRES EN LEUCOCITOS'),('PFC',null),('PFCF',null),('PXA1',null),('PXA2',null),('PXA3',null),('PPL',null),('GRF',null)
on conflict(code) do nothing;
-- No se insertan precios. Deben ser configurados explícitamente por un administrador.
