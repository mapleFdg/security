function all_aio_ci(page_size,tenant_param,type_param,last_time) {
	try {
		var last_id = 0;

		while (true) {
			var in_to_db = new Array();
			var cis;
			if (last_id == 0) {
				cis = db.CI.find({
					'del_flag' : 'N',
					'_tenant':tenant_param,
					'type':type_param,
					"dw_last_update_date" : {
						"$lt" : last_time
					}
				}).sort({
					"_id" : -1
				}).limit(page_size);
			} else {
				cis = db.CI.find({
					'del_flag' : 'N',
					'_tenant':tenant_param,
					'type':type_param,
					'_id' : {
						'$lt' : last_id
					},
					"dw_last_update_date" : {
						"$lt" : last_time
					}
				}).sort({
					"_id" : -1
				}).limit(page_size);
			}

			if (cis.length() < 1) {
				break;
			}
			
			var is_sync = db.getCollection('sync_international').find({"field_key":"aio_sync_key"});
			
			if(is_sync.length() < 1 || is_sync[0].field_en == 'n'){
				break;
			}

			for (var i = 0; i < cis.length(); i++) {
				var result_array = new Array();
				var ci = cis[i];
				last_id = ci._id;
				add_aio_ci(ci,in_to_db);
				var in_to_db_length = in_to_db.length;
				if (in_to_db_length > 800) {
					db.CIRELATION_AIO_5.bulkWrite(in_to_db, {
						ordered : false
					});
					in_to_db.splice(0, in_to_db_length);
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 0) {
				db.CIRELATION_AIO_5.bulkWrite(in_to_db, {
					ordered : false
				});
				in_to_db.splice(0, in_to_db_length);
			}

		}
	} catch (err) {
		var failure_ci = {
			"err_msg" : err
		}
		return failure_ci;
	}
}
