/**
 * 生成UUID
 * 
 * @returns
 */
function getUuid() {
	var s = [];
	var hexDigits = "0123456789abcdef";
	for (var i = 0; i < 36; i++) {
		s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
	}
	s[14] = "4";
	s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);
	s[8] = s[13] = s[18] = s[23] = "-";
	var uuid = s.join("");
	return uuid.replace(/-/g, '');
}

/**
 * 插入AIO
 * 
 * @param e_ci
 * @param s_ci
 * @param relation
 * @param ci_list
 * @param type_list
 * @param level
 * @param link_list
 * @param type_has
 * @returns
 */
function insert_aio_data(e_ci, s_ci, relation, ci_list, type_list, level,
		link_list, type_has, in_to_db) {
	var is_update = false;
	
	var exit_aio = db.CIRELATION_AIO_TEST5.find({
		'e_id' : e_ci.id,
		'e_type' : e_ci.type,
		's_id' : s_ci.id,
		's_type' : e_ci.type,
		'del_flag' : 'N'
//		'direct_flag':level
	});
	
	if(exit_aio.length() > 0){
		is_update = true;
	}
	
	var insert_data = {}; // 插入数据
	// 组装下层数据
	for ( var e_key in e_ci) {
		if (e_key != '_id') {
			insert_data["e_" + e_key] = e_ci[e_key];
		}
	}
	
		// 组装上层数据
	for ( var s_key in s_ci) {
		if (s_key != '_id') {
			insert_data["s_" + s_key] = s_ci[s_key];
		}
	}
	
	// 组装关系信息
	if (relation != undefined) {
		insert_data['source'] = relation['source'];
		insert_data['owner'] = relation['owner'];
		insert_data['type'] = relation['type'];
	}
	insert_data['id'] = getUuid();
	insert_data['_tenant'] = e_ci['_tenant'];
	insert_data['del_flag'] = 'N';
	insert_data['direct_flag'] = Number(level);

	// 最后更新时间
	insert_data['dw_last_update_date'] = NumberLong(new Date());

	insert_data['idList'] = ci_list; // 每层链路的CI_ID(包含乡下冗余)
	insert_data['has_type'] = type_has; // 包含的模型类型(有冗余数据)
	insert_data['link_list'] = link_list; // 每层链路的CI_ID(不包含乡下冗余)

	// 增加每一层的CI类型信息
	for ( var type_key in type_list) {
		insert_data[type_key] = type_list[type_key]; // 中间CI的信息
	}
	var op;
	
	if(is_update){
		op = {
				updateMany : {
					"filter" : {
						'e_id' : e_ci.id,
						'e_type' : e_ci.type,
						's_id' : s_ci.id,
						's_type' : e_ci.type,
						'del_flag' : 'N',
						'direct_flag':level
					},
					"update" : {
						$set : insert_data
					}
				}
		};
	}else{
		op = {
				insertOne : {
					"document" : insert_data
				}
			}
	}

	in_to_db.push(op);
	// 插入AIO
	// db.CIRELATION_AIO_TEST5.insert(insert_data);
}

/**
 * 关系增量时，处理上层的数据冗余
 * 
 * @param idList
 * @param has_type
 * @param type_list
 * @param e_ci
 * @returns
 */
function update_exit_aio(idList, has_type, type_list, s_ci,e_ci, in_to_db) {
	// 处理已存在的AIO更新
	var aios = db.CIRELATION_AIO_TEST5.find({
		'e_id' : s_ci.id,
		'direct_flag' : 1,
		'del_flag' : 'N'
	}); // 
	var aios_length = aios.length();
	
	
	for (var i = 0; i < aios_length; i++) {
		var aio_s_ci = aios[i];
		var count = db.CIRELATION_AIO_TEST5.find({
			's_id' : aio_s_ci.s_id,
			direct_flag : 1,
			'del_flag' : 'N'
		}).count();
		
		var is_special_type = ((e_ci.type == 'Rack' || e_ci.type == 'Room' || e_ci.type == 'DC' || e_ci.type == 'Region') 
					&& (s_ci.type == 'Rack' || s_ci.type == 'Room' || s_ci.type == 'DC' || s_ci.type == 'Region'));
		
		var aio_has_type = aio_s_ci.has_type;
		var aio_remove_has_type = new Array();
		var has_special = false;
		var is_have_other = false;
		var unsetJson = {};
		
		for(var k = 0; k < aio_has_type.length; k++){
			var k_aio_has_type = aio_has_type[k];
			if(k_aio_has_type == aio_s_ci.s_type || k_aio_has_type == aio_s_ci.e_type){
				continue;
			}
			if(k_aio_has_type == 'Rack' || k_aio_has_type == 'Room' || k_aio_has_type == 'DC' || k_aio_has_type == 'Region'){
				has_special = true;
				continue;
			}
			is_have_other = true;
			aio_remove_has_type.push(k_aio_has_type);
			unsetJson[k_aio_has_type] = 1;
		}
		
		var next_idList;
		var next_has_type;
		var next_type_list = {};
		
		// 有分支，则不需更新
		if (count == 1 || (is_special_type && !has_special)) {
			var s_aios = db.CIRELATION_AIO_TEST5.find({
				'e_id' : s_ci,
				'link_list' : {$in:[aio_s_ci.s_id]},
				'del_flag' : 'N'
			});
			for (var j = 0; j < s_aios.length(); j++) {
				var s_aio = s_aios[j];
				var s_idList = s_aio.idList;
				var s_link_list = s_aio.link_list;
				var s_has_type = s_aio.has_type;
				
				var s_new_idList;
				var s_new_has_type;

				
				if(is_have_other){
					s_new_has_type = new Array();
					for(var k = 0; k < s_has_type.length; k++){
						var is_remove = false;
						for(var f = 0; f < aio_remove_has_type.length; f++){
							if(s_has_type[k] == aio_remove_has_type[f]){
								if_remove = true;
								break;
							}
						}
						if(!is_remove){
							s_new_has_type.push(s_has_type[k]);
						}
					}
					
				}else{
					s_new_has_type = s_has_type.concat(has_type);
				}
				
				s_new_idList = s_link_list.concat(idList);
				
				var setJson = {
						"dw_last_update_date" : NumberLong(new Date()),
						"idList" : s_new_idList,
						"has_type" : s_new_has_type
					};
				
				for ( var type_key in type_list) {
					setJson[type_key] = type_list[type_key];
					if(s_aio.direct_flag == 0){
						next_type_list[type_key] = type_list[type_key];
					}
				}
				
				if(s_aio.direct_flag == 0){
					next_idList = s_new_idList;
					next_has_type = s_new_has_type;
					var to_to_s_json = s_aio[s_type];
					to_to_s_json['aio_num'] = to_to_s_json['to_to_json'] - 20;
					var to_to_e_json = s_aio[e_type];
					to_to_e_json['aio_num'] = to_to_e_json['to_to_json'] - 20;
					next_type_list[s_aio.s_type] = to_to_s_json;
					next_type_list[s_aio.e_type] = to_to_e_json;
				}
				
				var op = {
					updateMany : {
						"filter" : {
							'id' : s_aio.id
						},
						"update" : {
							"$set" : setJson,
							"$unset" : unsetJson
						}
					}
				};
				in_to_db.push(op);
			}
			update_exit_aio(next_idList, next_has_type, next_type_list, aio_s_ci.s_id,aio_s_ci.e_id, in_to_db);
		}
	}
}

/**
 * 向上递归
 * 
 * @param ci
 * @param e_id
 * @param e_name
 * @param level
 * @param ci_list
 * @param s_e_idList
 * @param type_list
 * @param has_type
 * @returns
 */
function aio_up_to_insert(ci, e_id, e_name, level, ci_list, s_e_idList,
		type_list, has_type, in_to_db) {
	var relations = db.RELATION.find({
		"e_id" : e_id,
		'del_flag' : 'N'
	});
	if (e_id != null && relations.length() > 0) {
		for (var i = 0; i < relations.length(); i++) {
			var new_ci_list = ci_list.concat();
			var new_has_type = has_type.concat();
			var new_type_list = JSON.parse(JSON.stringify(type_list));
			var s_ci = db.CI.find({
				'id' : relations[i].s_id,
				'del_flag' : 'N'
			});
			if (s_ci.length() > 0) {

				new_ci_list.push(s_ci[0].id);
				var type = s_ci[0].type;
				if (type == 'Region' && s_ci[0]['subtype'] == 'DCRegion') {
					type = 'DCArea';
				}
				new_has_type.push(type);
				new_type_list[type] = {
					'aio_num' : 0 - new_ci_list.length,
					'id' : s_ci[0].id,
					'name' : s_ci[0].name,
					'type' : s_ci[0].type,
					'name_en' : s_ci[0].name_en,
					'name_cn' : s_ci[0].name_cn,
					'subtype' : s_ci[0].subtype
				};
				insert_aio_data(ci, s_ci[0], relations[i], new_ci_list
						.concat(s_e_idList), new_type_list, level, new_ci_list,
						new_has_type, in_to_db);
				if (level <= 20) {
					aio_up_to_insert(ci, relations[i].s_id,
							relations[i].s_name, level + 1, new_ci_list,
							s_e_idList, new_type_list, new_has_type, in_to_db);
				}
			}
		}
	}
}

/**
 * 向下递归
 * 
 * @param s_ci
 * @param s_id
 * @param level
 * @param ci_list
 * @param type_list
 * @param result_array
 * @param link_list
 * @param is_first
 * @param type_has
 * @returns
 */
function aio_down_to_insert(s_ci, s_id, level, ci_list, type_list,
		result_array, link_list, is_first, type_has, in_to_db, relations,
		op_type) {
	var relations_length;
	// 判断是否已传关系，在关系递归是，首次会传入
	if (relations == undefined) {
		relations = db.RELATION.find({
			"s_id" : s_id,
			'del_flag' : 'N'
		});
		relations_length = relations.length();
	}else{
		relations_length = relations.length;
	}
	
	var is_carry = false; // 前数据是否被携带到下一个递归
	
	if (relations_length > 0) { // 判断是否存在关系
		for (var i = 0; i < relations_length; i++) { // 存在关系，进入循环
			var relation = relations[i];

			// 关系数据
			var e_id = relation.e_id;
			var e_type = relation.e_type;
			
			var link_list_string =link_list.toString(); 
			if(link_list_string.indexOf(e_id) > 0){ //  环形结构，直接跳出
				for (var j = 0; j < result_array.length; j++) { // 针对关系，查询信息
					var r_e_ci = new_result_array[j].e_ci;
					var r_s_ci = new_result_array[j].s_ci;
					var r_relation = new_result_array[j].relation;
					var r_level = new_result_array[j].direct_flag;
					var r_link_list = new_result_array[j].link_list;
					insert_aio_data(r_e_ci, r_s_ci, r_relation, new_ci_list,
							new_type_list, r_level, r_link_list, new_type_has, in_to_db);
				}
				result_array = new Array();
				continue;
			}

			var is_special_type = (e_type == 'Rack' || e_type == 'Room'
					|| e_type == 'DC' || e_type == 'Region');

			if (op_type == 'ci' && !is_special_type) { // ci操作，且不为特性类型，继续循环
				continue;
			}

			var e_cis = db.CI.find({
				'id' : e_id,
				'del_flag' : 'N'
			});

			var e_cis_length = e_cis.length();

			if (e_cis_length < 1) { // e_ci不存在
				continue;
			}
			if (op_type == 'ci') { // CI操作，CI存在，不继续下次循环
				i = relations_length;
				is_carry = true;
			}

			var is_alone = (relations_length == 1); // 是否单关系

			var new_link_list = link_list.concat();
			var new_ci_list = ci_list.concat();
			var new_type_list = JSON.parse(JSON.stringify(type_list));
			var new_type_has = type_has.concat();
			
			var new_result_array;

			if (op_type == 'ci' || is_alone || (is_special_type && !is_carry)) {
				new_result_array = result_array.concat();
				is_carry = true;
			} else {
				new_result_array = new Array();
			}

			var result_json = {};
			var e_ci = e_cis[0];

			var e_name = e_ci.name;
			var type = e_ci.type;
			if (type == 'Region' && e_ci['subtype'] == 'DCRegion') {
				type = 'DCArea';
			}

			new_ci_list.push(e_id);
			new_type_has.push(type);
			new_link_list.push(e_id);

			new_type_list[type] = {
				'aio_num' : new_ci_list.length,
				'id' : e_id,
				'name' : e_name,
				'type' : e_ci.type,
				'name_en' : e_ci.name_en,
				'name_cn' : e_ci.name_cn,
				'subtype' : e_ci.subtype
			};
			
			if (op_type != 'ci') {
				var result_json = {
					's_ci' : s_ci,
					'e_ci' : e_ci,
					'relation' : relation,
					'direct_flag' : level,
					'link_list' : new_link_list
				}
				new_result_array.push(result_json);

			}
			if (level <= 20) {
				aio_down_to_insert(s_ci, e_id, level + 1, new_ci_list,
						new_type_list, new_result_array, new_link_list, is_first,
						new_type_has, in_to_db, undefined, op_type);

			}else{
				for (var j = 0; j < new_result_array.length; j++) {
					var r_e_ci = new_result_array[j].e_ci;
					var r_s_ci = new_result_array[j].s_ci;
					var r_relation = new_result_array[j].relation;
					var r_level = new_result_array[j].direct_flag;
					var r_link_list = new_result_array[j].link_list;
					insert_aio_data(r_e_ci, r_s_ci, r_relation, new_ci_list,
							new_type_list, r_level, r_link_list, new_type_has, in_to_db);
				}
			}
		}
		if (!is_carry) {
			if (op_type == 'ci') { // 插入0层
				insert_aio_data(s_ci, s_ci, undefined, ci_list, type_list, 0,
						[ s_ci.id ], type_has, in_to_db);
			}
			if (result_array.length > 0) { // 顶层插入
				for (var j = 0; j < result_array.length; j++) {
					var r_e_ci = result_array[j].e_ci;
					var r_s_ci = result_array[j].s_ci;
					var r_relation = result_array[j].relation;
					var r_level = result_array[j].direct_flag;
					var r_link_list = result_array[j].link_list;
					insert_aio_data(r_e_ci, r_s_ci, r_relation, ci_list,
							type_list, r_level, r_link_list, type_has, in_to_db);
				}
			}
		}
	} else {
		if (op_type == 'ci') { // 插入0层
			insert_aio_data(s_ci, s_ci, undefined, ci_list, type_list, 0,
					[ s_ci.id ], type_has, in_to_db);
		}
		if (result_array.length > 0) { // 顶层插入
			for (var j = 0; j < result_array.length; j++) {
				var r_e_ci = result_array[j].e_ci;
				var r_s_ci = result_array[j].s_ci;
				var r_relation = result_array[j].relation;
				var r_level = result_array[j].direct_flag;
				var r_link_list = result_array[j].link_list;
				insert_aio_data(r_e_ci, r_s_ci, r_relation, ci_list, type_list,
						r_level, r_link_list, type_has, in_to_db);
			}
		}
	}
}

/**
 * 关系增量 -- 新增关系
 * 
 * @param relation
 * @returns
 */
function add_aio_relation(relation, in_to_db) {
	var e_id = relation.e_id;
	var e_type = relation.e_type;
	var s_id = relation.s_id;
	var s_type = relation.s_type;

	var aio_relation = db.CIRELATION_AIO_TEST5.find({
		'e_id' : e_id,
		'e_type' : e_type,
		's_id' : s_id,
		's_type' : s_type,
		'del_flag' : 'N'
	});
	if (aio_relation.length() > 0) {
		print("关系已存在");
		return "关系已存在";
	}

	var e_cis = db.CI.find({
		"id" : e_id,
		'del_flag' : 'N'
	});
	var s_cis = db.CI.find({
		"id" : s_id,
		'del_flag' : 'N'
	});

	if (e_cis.length() < 1 || s_cis.length() < 1) {
		return;
	}
	var e_ci = e_cis[0];
	var s_ci = s_cis[0];

	var s_ci_id = s_ci.id;
	var s_ci_name = s_ci.name;
	var s_ci_list = [ s_ci_id ];

	var s_type_list = {};

	var s_type = s_ci.type;
	if (s_type == 'Region' && s_ci['subtype'] == 'DCRegion') {
		s_type = 'DCArea';
	}
	s_type_list[s_type] = {
		'aio_num' : 0,
		'id' : s_ci_id,
		'name' : s_ci_name,
		'type' : s_ci.type,
		'name_en' : s_ci.name_en,
		'name_cn' : s_ci.name_cn,
		'subtype' : s_ci.subtype
	};
	var s_has_type = [ s_type ];

	var e_ci_id = e_ci.id;
	var e_ci_list = [ e_ci_id, s_ci_id ];

	var relation_down_in_to_db = new Array()
	
	// 向下增加直接关系
	aio_down_to_insert(s_ci, s_ci_id, 0, s_ci_list, s_type_list, new Array(),
			s_ci_list, true, s_has_type, relation_down_in_to_db,undefined,'relation');
	
	db.CIRELATION_AIO_TEST5.bulkWrite(relation_down_in_to_db, {
		ordered : false
	});
	
	var s_e_aios = db.CIRELATION_AIO_TEST5.find({
		"s_id" : s_ci_id,
		"e_id" : e_ci_id
	});

	var s_e_aio = s_e_aios[0];

	var s_e_idList = s_e_aio.idList;
	var s_e_has_type = s_e_aio.has_type;
	var s_e_type_list = {};
	for (var k = 0; k < s_e_has_type.length; k++) {
		s_e_type_list[s_e_has_type[k]] = s_e_aio[s_e_has_type[k]];
	}

	var relation_up_in_to_db = new Array()
	
	// 向上增加直接关系
	aio_up_to_insert(e_ci, s_ci_id, s_ci_name, 1, e_ci_list, s_e_idList,
			s_e_type_list, s_e_has_type, relation_up_in_to_db);
	
	db.CIRELATION_AIO_TEST5.bulkWrite(relation_up_in_to_db, {
		ordered : false
	});

	update_exit_aio(s_e_idList, s_e_has_type, s_e_type_list, s_ci,e_ci, in_to_db);
}

/**
 * CI增量--新增CI
 * 
 * @param ci
 * @returns
 */
function add_aio_ci(ci, in_to_db) {
	var id = ci.id;

	var has_relation = db.RELATION.find({
		"$or" : [ {
			"e_id" : id
		}, {
			"s_id" : id
		} ]
	}).count();

	if (has_relation == 0) {
		var name = ci.name;
		var level = 0;
		var ci_list = [ id ];

		var ci_type = ci.type;
		if (ci_type == "Region" && ci['subtype'] == 'DCRegion') {
			ci_type = 'DCArea';
		}
		var type_list = {};
		type_list[ci_type] = {
			'name' : ci.name,
			'id' : id,
			'name_en' : ci.name_en,
			'name_cn' : ci.name_cn,
			'type' : ci_type,
			'subtype' : ci.subtype
		}
		var type_has = [ ci_type ];

		insert_aio_data(ci, ci, undefined, ci_list, type_list, level, ci_list,
				type_has, in_to_db);
	}
}

/**
 * 关系增量
 * 
 * @param page
 * @param page_size
 * @param last_update_time
 * @returns
 */
function incr_relation_aio(page_size, last_update_time,tenant_param,type_param) {
	try {

		var last_id = 0;

		while (true) {
			var in_to_db = new Array();
			var relations;
			if (last_id == 0) {
				relations = db.RELATION.find({
					"dw_last_update_date" : {
						"$gt" : last_update_time
					},
					"_tenant":tenant_param,
					's_type':type_param
				}).sort({
					"_id" : 1
				}).limit(page_size);
			} else {
				relations = db.RELATION.find({
					"dw_last_update_date" : {
						"$gt" : last_update_time
					},
					"_id" : {
						"$gt" : last_id
					},
					"_tenant":tenant_param,
					's_type':type_param
				}).sort({
					"_id" : 1
				}).limit(page_size);
			}
			for (var i = 0; i < relations.length(); i++) {
				var relation = relations[i];
				last_id = relation._id;
				var del_flag = relation.del_flag;
				if (del_flag == 'Y') {
					var op = {
						updateMany : {
							"filter" : {
								$and : [ {
									"link_list" : {
										$in : [ relation.e_id ]
									}
								}, {
									"link_list" : {
										$in : [ relation.s_id ]
									}
								} ]
							},
							"update" : {
								"$set" : {
									"del_flag" : 'Y',
									"dw_last_update_date" : NumberLong(new Date())
								}
							}
						}
					};
					in_to_db.push(op);

					// db.CIRELATION_AIO_TEST5.update({
					// $and : [ {
					// "link_list" : {
					// $in : [ relation.e_id ]
					// }
					// }, {
					// "link_list" : {
					// $in : [ relation.s_id ]
					// }
					// } ]
					// }, {
					// "$set" : {
					// "del_flag" : 'Y',
					// "dw_last_update_date" : new Date().getTime()
					// }
					// }, {
					// multi : true
					// });
					var upLists = db.CIRELATION_AIO_TEST5.find({
						"idList" : {
							$in : [ relation.e_id, relation.s_id ]
						},
						"del_flag" : 'N'
					});
					for (var j = 0; j < upLists.length(); j++) {
						var ci_type = relation.s_type;
						if (ci_type == "Region"
								&& relation['s_subtype'] == 'DCRegion') {
							ci_type = 'DCArea';
						}
						var aio_ci = upLists[j];
						var unsetJson = {};

						var aio_num = aio_ci[ci_type].aio_num;

						var new_has_type = [];
						var new_idList = [];
						var has_type = aio_ci.has_type;

						for (var k = 0; k < has_type.length; k++) {
							var in_type = aio_ci[has_type[k]];

							var k_aio_num = in_type.aio_num;

							if (aio_num <= k_aio_num) {
								unsetJson[has_type[k]] = 1;
							} else {
								new_has_type.push(has_type[k]);
								new_idList.push(in_type.id);
							}

						}
						var op_for = {
							updateMany : {
								"filter" : {
									"id" : aio_ci.id
								},
								"update" : {
									"$set" : {
										"dw_last_update_date" : NumberLong(new Date()),
										"idList" : new_idList,
										"has_type" : new_has_type
									},
									"$unset" : unsetJson
								}
							}
						};
						in_to_db.push(op_for);
						// db.CIRELATION_AIO_TEST5.update({
						// "id" : aio_ci.id
						// }, {
						// "$set" : {
						// "dw_last_update_date" : new Date().getTime(),
						// "idList" : new_idList,
						// "has_type" : new_has_type
						// },
						// "$unset" : unsetJson
						// }, {
						// multi : true
						// });
					}
				} else {
					add_aio_relation(relation, in_to_db);
				}
				var in_to_db_length = in_to_db.length;
				if (in_to_db_length > 800) {
					db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
						ordered : false
					});
					in_to_db.splice(0, in_to_db_length);
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 0) {
				db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
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

/**
 * 全量CI
 * 
 * @param page
 * @param page_size
 * @returns
 */
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

			for (var i = 0; i < cis.length(); i++) {
				var result_array = new Array();
				var ci = cis[i];
				last_id = ci._id;
				var id = ci.id;
				var level = 1;
				var ci_list = [ id ];
				var link_list = [ id ];
				var type_list = {};
				var type_has = new Array();
				var type = ci.type;

				if (type == 'Region' && ci['subtype'] == 'DCRegion') {
					type = 'DCArea';
				}

				type_has.push(type);
				type_list[type] = {
					'aio_num' : 0,
					'id' : id,
					'name' : ci.name,
					'type' : ci.type,
					'name_en' : ci.name_en,
					'name_cn' : ci.name_cn,
					'subtype' : ci.subtype
				};
				aio_down_to_insert(ci, id, level, ci_list, type_list,
						result_array, link_list, true, type_has, in_to_db,undefined,'ci');
				var in_to_db_length = in_to_db.length;
				if (in_to_db_length > 800) {
					db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
						ordered : false
					});
					in_to_db.splice(0, in_to_db_length);
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 0) {
				db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
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

/**
 * 全量Relation
 * 
 * @param page
 * @param page_size
 * @returns
 */
function all_aio_relation(page_size,tenant_param,type_param,last_time) {
	try{
		var last_id = 0
		
		while(true){
			var relations;
			var find_filter;
			var in_to_db = new Array();
			if(last_id == 0){
				find_filter = {
					"_tenant":tenant_param,
					"s_type":type_param,
					"del_flag":'N',
					"dw_last_update_date" : {
						"$lt" : last_time
					}
				};
			}else{
				find_filter = {
					"_tenant":tenant_param,
					"s_type":type_param,
					"del_flag":'N',
					"_id":{"$lt":last_id},
					"dw_last_update_date" : {
						"$lt" : last_time
					}
				};
			}
			relations = db.RELATION.find(find_filter).sort({"_id":-1}).limit(page_size);
			if(relations.length() < 1){
				break;
			}
			for(var i = 0;i < relations.length(); i++){
				var relation = relations[i];
				var last_id = relation._id;
				var s_id = relation.s_id;
				var cis = db.CI.find({'id':s_id,'del_flag':'N'});
				if(cis.length() < 1){
					continue;
				}
				var ci = cis[0];
				var e_id = relation.e_id;
				var e_type = relation.e_type;
				var s_type = relation.s_type;
				if (s_type == 'Region' && ci['subtype'] == 'DCRegion') {
					s_type = 'DCArea';
				}
				
				var level = 1;
				var ci_list = [s_id];
				var link_list = [s_id];
				
				var type_has = [s_type];
				
				var type_list = {};
				
				var result_array = new Array;
				
				type_list[s_type]={
						'aio_num' : 1,
						'id' : s_id,
						'name' : ci.name,
						'type' : ci.type,
						'name_en' : ci.name_en,
						'name_cn' : ci.name_cn,
						'subtype' : ci.subtype
				};
				
				aio_down_to_insert(ci, e_id, level, ci_list, type_list,
						result_array, link_list, false, type_has,in_to_db,[relation],'relation');
				var in_to_db_length = in_to_db.length;
				if (in_to_db_length > 800) {
					db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
						ordered : false
					});
					in_to_db.splice(0, in_to_db_length);
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 0) {
				db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
					ordered : false
				});
				in_to_db.splice(0, in_to_db_length);
			}
		}
	}catch(err){
		var failure = {
				"err_msg" : err
		}
		//return failure;
	}
}

/**
 * CI增量
 * 
 * @param page
 * @param page_size
 * @param last_update_time
 * @returns
 */
function incr_ci_aio(page_size, last_update_time,tenant_param,type_param) {
	try {
		var last_id = 0;

		while (true) {
			var cis;
			var in_to_db = new Array();
			if (last_id == 0) {
				cis = db.CI.find({
					"dw_last_update_date" : {
						"$gt" : last_update_time
					},
					"_tenant":tenant_param,
					"type":type_param
				}).sort({
					"_id" : 1
				}).limit(page_size);
			} else {
				cis = db.CI.find({
					"dw_last_update_date" : {
						"$gt" : last_update_time
					},
					"_tenant":tenant_param,
					"type":type_param,
					"_id" : {
						"$gt" : last_id
					}
				}).sort({
					"_id" : 1
				}).limit(page_size);
			}
			if (cis.length() < 1) {
				break;
			}
			for (var i = 0; i < cis.length(); i++) {
				var ci = cis[i];
				last_id = ci._id;
				var del_flag = ci.del_flag;

				var aio_cis = db.CIRELATION_AIO_TEST5.find({
					"idList" : {
						$in : [ ci.id ]
					}
				});

				var ci_type = ci.type;
				if (ci_type == "Region" && ci['subtype'] == 'DCRegion') {
					ci_type = 'DCArea';
				}

				if (del_flag == 'Y') {
					for (var i = 0; i < aio_cis.length(); i++) {
						var aio_ci = aio_cis[i];
						var link_list = aio_ci.link_list;
						var has_type = aio_ci.has_type;
						var is_pass_ci = false;
						for (var j = 0; j < link_list.length; j++) {
							var aio_ci_id = link_list[j];
							if (aio_ci_id == ci.id) {
								is_pass_ci = true;
								break;
							}
						}
						if (is_pass_ci) {
							var op = {
								updateMany : {
									"filter" : {
										"id" : aio_ci.id
									},
									"update" : {
										"$set" : {
											"del_flag" : 'Y',
											"dw_last_update_date" : NumberLong(new Date())
										}
									}
								}
							};
							in_to_db.push(op);

							// db.CIRELATION_AIO_TEST5.update({
							// "id" : aio_ci.id
							// }, {
							// "$set" : {
							// "del_flag" : 'Y',
							// "dw_last_update_date" : new Date().getTime()
							// }
							// }, {
							// multi : true
							// });
						} else {
							var unsetJson = {};

							var aio_num = aio_ci[ci_type].aio_num;

							var new_has_type = [];
							var new_idList = [];

							for (var k = 0; k < has_type.length; k++) {
								var in_type = aio_ci[has_type[k]];

								var k_aio_num = in_type.aio_num;

								if (aio_num <= k_aio_num) {
									unsetJson[has_type[k]] = 1;
								} else {
									new_has_type.push(has_type[k]);
									new_idList.push(in_type.id);
								}

							}
							var op = {
								updateMany : {
									"filter" : {
										"id" : aio_ci.id
									},
									"update" : {
										"$set" : {
											"dw_last_update_date" : NumberLong(new Date()),
											"idList" : new_idList,
											"has_type" : new_has_type
										},
										"$unset" : unsetJson
									}
								}
							};
							in_to_db.push(op);
							// db.CIRELATION_AIO_TEST5.update({
							// "id" : aio_ci.id
							// }, {
							// "$set" : {
							// "dw_last_update_date" : new Date().getTime(),
							// "idList" : new_idList,
							// "has_type" : new_has_type
							// },
							// "$unset" : unsetJson
							// }, {
							// multi : true
							// });
						}

					}
				} else {
					if (aio_cis.length() > 0) {
						// 修改
						for (var j = 0; j < aio_cis.length(); j++) {
							var aio_ci = aio_cis[j];
							var new_aio_ci = {};
							var level = aio_ci.direct_flag;
							var e_id = aio_ci.e_id;
							var s_id = aio_ci.s_id;
							var new_type = {
								'name' : ci.name,
								'name_en' : ci.name_en,
								'name_cn' : ci.name_cn,
								'type' : ci_type,
								'id' : ci.id,
								'subtype' : ci.subtype
							};

							if (e_id == ci.id && e_id == s_id) {
								var e_type = aio_ci.e_type;
								for ( var key in aio_ci) {
									if (key.match(/^e_/) != 'e_'
											&& key.match(/^s_/) != 's_') {
										new_aio_ci[key] = aio_ci[key];
									}
								}
								for ( var e_key in ci) {
									if (e_key != '_id') {
										new_aio_ci["e_" + e_key] = ci[e_key];
										new_aio_ci["s_" + e_key] = ci[e_key];
									}
								}
							} else if (ci.id == e_id) {
								var e_type = aio_ci.e_type;
								for ( var key in aio_ci) {
									if (key.match(/^e_/) != 'e_') {
										new_aio_ci[key] = aio_ci[key];
									}
								}
								for ( var e_key in ci) {
									if (e_key != '_id') {
										new_aio_ci["e_" + e_key] = ci[e_key];
									}
								}
							} else if (ci.id == s_id) {
								for ( var key in aio_ci) {
									if (key.match(/^s_/) != 's_') {
										new_aio_ci[key] = aio_ci[key];
									}
								}
								for ( var s_key in ci) {
									if (s_key != '_id') {
										new_aio_ci["s_" + s_key] = ci[s_key];
									}
								}
							} else {
								new_aio_ci = aio_ci;
							}

							new_aio_ci[ci_type] = new_type;

							new_aio_ci['dw_last_update_date'] = (new Date())
									.valueOf();
							var op = {
								updateMany : {
									"filter" : {
										'id' : aio_ci.id
									},
									"update" : {
										"$set" : new_aio_ci
									}
								}
							};
							in_to_db.push(op);
							// db.CIRELATION_AIO_TEST5.update({
							// 'id' : aio_ci.id
							// }, new_aio_ci);
						}
					} else {
						add_aio_ci(ci, in_to_db);
					}
				}
				var in_to_db_length = in_to_db.length;
				if (in_to_db_length > 800) {
					db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
						ordered : false
					});
					in_to_db.splice(0, in_to_db_length);
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 0) {
				db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
					ordered : false
				});
				in_to_db.splice(0, in_to_db_length);
			}
		}
	} catch (err) {
		var failure_ci = {
			"last_update_time" : last_update_time,
			"current_time" : new Date().getTime(),
			"err_msg" : err
		}
		return failure_ci;
	}
}

/**
 * 重复性检查
 * 
 * @param start_time
 * @returns
 */
function aio_repeat_check(start_time) {
	var last_id = 0;
	var page_size = 1000;
	while(true){
		var in_to_db = new Array();
		var aios;
		if(last_id == 0){
			aios = db.CIRELATION_AIO_TEST5.find({
				"dw_last_update_date" : {
					"$gt" : start_time
				},
				'del_flag' : 'N'
			}).sort({
				"_id" : 1
			}).limit(page_size)
		}else{
			aios = db.CIRELATION_AIO_TEST5.find({
				"dw_last_update_date" : {
					"$gt" : start_time
				},
				"_id" : {
					"$gt" : last_id
				},
				'del_flag' : 'N'
			}).sort({
				"_id" : 1
			}).limit(page_size)
		}
		
		if(aios.length() < 1){
			break;
		}
		
		for (var i = 0; i < aios.length(); i++) {
			var aio = aios[i];
			last_id = aio._id;
			var level = aio.direct_flag;
			var same_aio;
			var e_type = aio.e_type;
			var e_name = aio.e_name;
			if (e_name == undefined || e_type == undefined) {
				var op = {deleteMany:{
					"filter" : {"id" : aio.id}
				}};
				in_to_db.push(op);
//				db.CIRELATION_AIO_TEST5.remove({
//					"id" : aio.id
//				});
			} else {
				var s_type = aio.s_type;
				var s_name = aio.s_name;
				var _tenant = aio._tenant;
				same_aio = db.CIRELATION_AIO_TEST5.find({
					'e_type' : e_type,
					'e_name' : e_name,
					's_type' : s_type,
					's_name' : s_name,
					'level' : level,
					'_tenant' : _tenant,
					'del_flag' : 'N'
				});
				if (same_aio.length() > 1) {
					for (var j = 1; j < same_aio.length(); j++) {
						var same_id = same_aio[j].id;
						db.CIRELATION_AIO_TEST5.remove({
							"id" : same_id
						});
						var op2 = {deleteMany:{
							"filter" : {"id" : same_id}
						}};
						in_to_db.push(op2);
					}
				}
			}
			var in_to_db_length = in_to_db.length;
			if (in_to_db_length > 800) {
				db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
					ordered : false
				});
				in_to_db.splice(0, in_to_db_length);
			}
		}
		var in_to_db_length = in_to_db.length;
		if (in_to_db_length > 0) {
			db.CIRELATION_AIO_TEST5.bulkWrite(in_to_db, {
				ordered : false
			});
			in_to_db.splice(0, in_to_db_length);
		}
	}
}
