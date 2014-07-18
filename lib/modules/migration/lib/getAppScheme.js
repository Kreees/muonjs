module.exports = function(self, deps) {
    var _ = require('underscore');
    return function(){
        var schema = {};
        var names = deps.models.getModelsNames();
        _.forEach(names, function(name){
            var fullD = deps.models.getDescriptor(name);
            var mD = {
                attributes: fullD.attributes,
                collection: fullD.collection,
                db: fullD.db,
                hasOne: fullD.hasOne,
                hasMany: fullD.hasMany
            };
            if(!schema[mD.db]){
               schema[mD.db] = {}; 
            }
            schema[mD.db][name] = mD;
        });
        return schema;
    };
};