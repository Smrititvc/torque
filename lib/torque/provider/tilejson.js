  var torque = require('../');

  var Uint8Array = torque.types.Uint8Array;
  var Int32Array = torque.types.Int32Array;
  var Uint32Array = torque.types.Uint32Array;
  var Uint8ClampedArray = torque.types.Uint8ClampedArray;

  // format('hello, {0}', 'rambo') -> "hello, rambo"
  function format(str) {
    for(var i = 1; i < arguments.length; ++i) {
      var attrs = arguments[i];
      for(var attr in attrs) {
        str = str.replace(RegExp('\\{' + attr + '\\}', 'g'), attrs[attr]);
      }
    }
    return str;
  }

  var tileJSON = function (options) {
    this._ready = false;
    this._tileQueue = [];
    this.options = options;

    this.options.coordinates_data_type = this.options.coordinates_data_type || Uint8Array;

    if (this.options.data_aggregation) {
      this.options.cumulative = this.options.data_aggregation === 'cumulative';
    }
    if (this.options.auth_token) {
      var e = this.options.extra_params || (this.options.extra_params = {});
      e.auth_token = this.options.auth_token;
    }
    if (!this.options.no_fetch_map) {
      this._fetchMap();
    }
  };

  tileJSON.prototype = {

    NAME: "tileJSON",

    /**
     * return the torque tile encoded in an efficient javascript
     * structure:
     * {
     *   x:Uint8Array x coordinates in tile reference system, normally from 0-255
     *   y:Uint8Array y coordinates in tile reference system
     *   Index: Array index to the properties
     * }
     */
    proccessTile: function(rows, coord, zoom) {
      var r;
      var x = new this.options.coordinates_data_type(rows.length);
      var y = new this.options.coordinates_data_type(rows.length);

      // count number of dates
      var dates = 0;
      var maxDateSlots = -1;
      for (r = 0; r < rows.length; ++r) {
        var row = rows[r];
        dates += row.dates__uint16.length;
        for(var d = 0; d < row.dates__uint16.length; ++d) {
          maxDateSlots = Math.max(maxDateSlots, row.dates__uint16[d]);
        }
      }

      if(this.options.cumulative) {
        dates = (1 + maxDateSlots) * rows.length;
      }

      var type = this.options.cumulative ? Uint32Array: Uint8ClampedArray;

      // reserve memory for all the dates
      var timeIndex = new Int32Array(maxDateSlots + 1); //index-size
      var timeCount = new Int32Array(maxDateSlots + 1);
      var renderData = new (this.options.valueDataType || type)(dates);
      var renderDataPos = new Uint32Array(dates);

      var rowsPerSlot = {};

      // precache pixel positions
      for (var r = 0; r < rows.length; ++r) {
        var row = rows[r];
        x[r] = row.x__uint8 * this.options.resolution;
        y[r] = row.y__uint8 * this.options.resolution;

        var dates = row.dates__uint16;
        var vals = row.vals__uint8;
        if (!this.options.cumulative) {
          for (var j = 0, len = dates.length; j < len; ++j) {
              var rr = rowsPerSlot[dates[j]] || (rowsPerSlot[dates[j]] = []);
              if(this.options.cumulative) {
                  vals[j] += prev_val;
              }
              prev_val = vals[j];
              rr.push([r, vals[j]]);
          }
        } else {
          var valByDate = {}
          for (var j = 0, len = dates.length; j < len; ++j) {
            valByDate[dates[j]] = vals[j];
          }
          var accum = 0;

          // extend the latest to the end
          for (var j = dates[0]; j <= maxDateSlots; ++j) {
              var rr = rowsPerSlot[j] || (rowsPerSlot[j] = []);
              var v = valByDate[j];
              if (v) {
                accum += v;
              }
              rr.push([r, accum]);
          }
        }
      }

      // for each timeslot search active buckets
      var renderDataIndex = 0;
      var timeSlotIndex = 0;
      var i = 0;
      for(var i = 0; i <= maxDateSlots; ++i) {
        var c = 0;
        var slotRows = rowsPerSlot[i]
        if(slotRows) {
          for (var r = 0; r < slotRows.length; ++r) {
            var rr = slotRows[r];
            ++c;
            renderDataPos[renderDataIndex] = rr[0]
            renderData[renderDataIndex] = rr[1];
            ++renderDataIndex;
          }
        }
        timeIndex[i] = timeSlotIndex;
        timeCount[i] = c;
        timeSlotIndex += c;
      }

      return {
        x: x,
        y: y,
        z: zoom,
        coord: {
          x: coord.x,
          y: coord.y,
          z: zoom
        },
        timeCount: timeCount,
        timeIndex: timeIndex,
        renderDataPos: renderDataPos,
        renderData: renderData,
        maxDate: maxDateSlots
      };
    },

    setSteps: function(steps, opt) { 
      opt = opt || {};
      if (this.options.steps !== steps) {
        this.options.steps = steps;
        this.options.step = (this.options.end - this.options.start)/this.getSteps();
        this.options.step = this.options.step || 1;
        if (!opt.silent) this.reload();
      }
    },

    setOptions: function(opt) {
      var refresh = false;

      if(opt.resolution !== undefined && opt.resolution !== this.options.resolution) {
        this.options.resolution = opt.resolution;
        refresh = true;
      }

      if(opt.steps !== undefined && opt.steps !== this.options.steps) {
        this.setSteps(opt.steps, { silent: true });
        refresh = true;
      }

      if(opt.column !== undefined && opt.column !== this.options.column) {
        this.options.column = opt.column;
        refresh = true;
      }

      if(opt.countby !== undefined && opt.countby !== this.options.countby) {
        this.options.countby = opt.countby;
        refresh = true;
      }

      if(opt.data_aggregation !== undefined) {
        var c = opt.data_aggregation === 'cumulative';
        if (this.options.cumulative !== c) {
          this.options.cumulative = c;
          refresh = true;
        }
      }

      if (refresh) this.reload();
      return refresh;
    },

    _extraParams: function(e) {
      e = torque.extend(torque.extend({}, e), this.options.extra_params);
      if (e) {
        var p = [];
        for(var k in e) {
          var v = e[k];
          if (v) {
            if (torque.isArray(v)) {
              for (var i = 0, len = v.length; i < len; i++) {
                p.push(k + "[]=" + encodeURIComponent(v[i]));
              }
            } else {
              p.push(k + "=" + encodeURIComponent(v));
            }
          }
        }
        return p.join('&');
      }
      return null;
    },

    getTileData: function(coord, zoom, callback) {
      if(!this._ready) {
        this._tileQueue.push([coord, zoom, callback]);
      } else {
        this._getTileData(coord, zoom, callback);
      }
    },

    _setReady: function(ready) {
      this._ready = true;
      this._processQueue();
      this.options.ready && this.options.ready();
    },

    _processQueue: function() {
      var item;
      while (item = this._tileQueue.pop()) {
        this._getTileData.apply(this, item);
      }
    },

    /**
     * `coord` object like {x : tilex, y: tiley }
     * `zoom` quadtree zoom level
     */
    _getTileData: function(coord, zoom, callback) {
      var self = this;
      var subdomains = this.options.subdomains || '0123';
      var limit_x = Math.pow(2, zoom);
      var corrected_x = ((coord.x % limit_x) + limit_x) % limit_x;
      var index = Math.abs(corrected_x + coord.y) % subdomains.length;
      var extra = this._extraParams();
      var url = this.templateUrl
                .replace('{x}', corrected_x)
                .replace('{y}', coord.y)
                .replace('{z}', zoom)
                .replace('{s}', subdomains[index])
      url += extra;
      torque.net.get( url , function (data) {
        if (data && data.responseText) {
          var rows = JSON.parse(data.responseText);
          callback(self.proccessTile(rows, coord, zoom));
        } else {
          callback(null);
        }
      });
    },

    getKeySpan: function() {
      return {
        start: this.options.start,
        end: this.options.end,
        step: this.options.step,
        steps: this.options.steps,
        columnType: this.options.column_type
      };
    },

    setColumn: function(column, isTime) {
      this.options.column = column;
      this.options.is_time = isTime === undefined ? true: false;
      this.reload();
    },

    reload: function() {
      this._ready = false;
      this._fetchMap();
    },

    getSteps: function() {
      return Math.min(this.options.steps, this.options.data_steps);
    },

    getBounds: function() {
      return this.options.bounds;
    },

    getSQL: function() {
      return this.options.sql || "select * from " + this.options.table;
    },

    setSQL: function(sql) {
      if (this.options.sql != sql) {
        this.options.sql = sql;
        this.reload();
      }
    },

    _isUserTemplateUrl: function(t) {
      return t && t.indexOf('{user}') !== -1;
    },

    isHttps: function() {
      return this.options.maps_api_template.indexOf('https') === 0;
    },

    _fetchMap: function(callback) {
      var self = this;
      torque.net.get(this.options.tileJSON, function (data) {
        data = JSON.parse(data.response);
        if (data) {
          if (data.errors){
            self.options.errorCallback && self.options.errorCallback(data.errors);
            return;
          }
          for(var k in data) {
            self.options[k] = data[k];
          }
          self.templateUrl = data.tiles[0];
          if (self.templateUrl.indexOf("http") !== 0){
            self.templateUrl = self.options.tileJSON.substring(0, self.options.tileJSON.lastIndexOf("/") + 1) + self.templateUrl;
          }
          self._setReady(true);
        }
      });
    }
  };

  module.exports = tileJSON;