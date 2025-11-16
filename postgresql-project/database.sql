
select * from opportunities;--2

	select * from opportunity_images; 
	select * from customers;   --2

	select * from contracts;--1

	select * from reminders;    --0

	select * from reminders_audit_v2; 

	select * from expenses; 
	select * from expenses_audit ;

	select * from opportunity_stage_audit;

	select * from meetings;  --0
	
	select * from targets;  
	select * from meetings_audit;
	
	select * from meetings_audit_v2;
	
	select * from meeting_email_audit;


select * from users;
select * from user_photos;
select * from user_profiles;

select * from users_password_audit;


select * from user_permissions;

select * from stages;

TRUNCATE TABLE expenses_audit;

--0

	
	
	
	select * from dispenser_daily_readings;  --delete 
	select * from dispenser_readings;  --delete
	
	select * from drivers; --active and ok

	select * from fuel_lot_activities ;
	 
	select * from fuel_internal_transfers ; --ok 

	select * from fule_lots ; --ok
	
	select * from fuel_sale_transfers ; 

	
	select * from storage_units; --active and ok 
	
	
	-- select * from truck_daily_readings; -- deprecated
	
	select * from truck_dispenser_day_readings; --delete 
	
	select * from truck_dispenser_meter_snapshots ; -- snapshots 
	
	select * from truck_dispenser_trips ; ---depo opening and closing record

	select * from truck_odometer_day_readings;  --odometer
	
	-- select * from truck_odometer_readings;   -- deprecated

	select * from dispenser_day_reading_logs; 
	
BEGIN;

-- Replace public.table_name with your table (e.g., public.truck_dispenser_day_readings)
TRUNCATE TABLE public.truck_dispenser_trips RESTART IDENTITY;

COMMIT;

DELETE FROM truck_dispenser_trips
WHERE opening_liters  = 20000 ;
