/*global MM, _, observable, jQuery*/
MM.MeasuresModel = function (configAttributeName, valueAttrName, mapController, defaultFilter) {
	'use strict';
	var self = observable(this),
		activeContent,
		measures = [],
		latestMeasurementValues = [],
		filter,
		onFilterChanged = function () {
			self.dispatchEvent('measureRowsChanged');
		},
		getActiveContentMeasures = function () {
			var value = activeContent && activeContent.getAttr(configAttributeName);
			if (!_.isArray(value)) {
				return [];
			}
			return value;
		},
		mapMeasurements = function (measurements) {
			var map = {};
			_.each(measurements, function (measurement) {
				map[measurement.id] = measurement;
			});
			return map;
		},
		measurementValueDifferences = function (measurement, baseline) {
			var difference = [];
			_.each(measurement.values, function (value, key) {
				var baselineValue = (baseline && baseline.values && baseline.values[key]) || 0;
				if (value !== baselineValue) {
					difference.push(['measureValueChanged', measurement.id, key, value || 0]);
				}
			});
			if (baseline) {
				_.each(baseline.values, function (value, key) {
					var noNewValue = !measurement || !measurement.values || !measurement.values[key];
					if (noNewValue) {
						difference.push(['measureValueChanged', baseline.id, key, 0]);
					}
				});
			}
			return difference;
		},
		measurementDifferences = function (measurements, baslineMeasurements) {
			/*{id: 11, title: 'with values', values: {'Speed': 1, 'Efficiency': 2}}*/
			var baslineMeasurementsMap = mapMeasurements(baslineMeasurements),
				differences = [];
			_.each(measurements, function (measurement) {
				var baseline = baslineMeasurementsMap[measurement.id];
				differences = differences.concat(measurementValueDifferences(measurement, baseline));
			});
			return differences;
		},
		dispatchMeasurementChangedEvents = function () {
			if (self.listeners('measureValueChanged').length === 0) {
				return;
			}
			var oldMeasurementValues = latestMeasurementValues,
				differences = measurementDifferences(self.getMeasurementValues(), oldMeasurementValues);
			_.each(differences, function (changeArgs) {
				self.dispatchEvent.apply(self, changeArgs);
			});
		},
		onActiveContentChange = function () {
			var measuresBefore = measures;
			measures = getActiveContentMeasures();
			if (self.listeners('measureRemoved').length > 0) {
				_.each(_.difference(measuresBefore, measures), function (measure) {
					self.dispatchEvent('measureRemoved', measure);
				});
			}
			if (self.listeners('measureAdded').length > 0) {
				_.each(_.difference(measures, measuresBefore), function (measure) {
					self.dispatchEvent('measureAdded', measure, measures.indexOf(measure));
				});
			}
			dispatchMeasurementChangedEvents();
		};
	mapController.addEventListener('mapLoaded', function (id, content) {
		if (activeContent) {
			activeContent.removeEventListener('changed', onActiveContentChange);
		}
		activeContent = content;
		measures = getActiveContentMeasures();
		self.dispatchEvent('startFromScratch');
		activeContent.addEventListener('changed', onActiveContentChange);
	});
	self.editingMeasure = function (isEditing, nodeId) {

		self.dispatchEvent('measureEditing', isEditing, nodeId);
	};
	self.getMeasures = function () {
		return measures.slice(0);
	};
	self.editWithFilter = function (newFilter) {
		if (filter) {
			self.removeFilter();
		}
		filter = newFilter;
		if (filter && filter.addEventListener) {
			filter.addEventListener('filteredRowsChanged', onFilterChanged);
		}
	};
	self.addUpMeasurementForAllNodes = function (measurementName) {
		if (!activeContent || !measurementName) {
			return {};
		}
		var result = {},
			addUpMeasure = function (idea) {
				var measures = idea.getAttr(valueAttrName), sum = 0, hasValue = false;
				if (measures && measures[measurementName]) {
					sum = parseFloat(measures[measurementName]);
					hasValue = true;
				}
				if (idea.ideas) {
					_.each(idea.ideas, function (subIdea) {
						if (result[subIdea.id] !== undefined) {
							hasValue = true;
							sum += result[subIdea.id];
						}
					});
				}
				if (hasValue) {
					result[idea.id] = sum;
				}
			};
		activeContent.traverse(addUpMeasure, true);
		return result;
	};
	self.getMeasurementValues = function () {
		if (!activeContent) {
			return [];
		}
		var result = [];
		activeContent.traverse(function (idea) {
			if (!filter || filter.predicate(idea)) {
				var newVals = {};
				_.each(_.extend({}, idea.getAttr(valueAttrName)), function (val, key) {
					if (val === undefined) {
						return;
					}
					if (!isNaN(parseFloat(val))) {
						newVals[key] = val;
					}
				});
				result.push({
					id: idea.id,
					title: idea.title,
					values: newVals
				});
			}
		});
		latestMeasurementValues = result.slice(0);
		return result;
	};
	self.addMeasure = function (measureName) {
		if (!measureName || measureName.trim() === '') {
			return false;
		}
		measureName = measureName.trim();

		if (_.find(measures, function (measure) { return measure.toUpperCase() === measureName.toUpperCase(); })) {
			return false;
		}
		activeContent.updateAttr(activeContent.id, configAttributeName, measures.concat([measureName]));
	};
	self.removeMeasure = function (measureName) {
		if (!measureName || measureName.trim() === '') {
			return false;
		}
		var updated = _.without(measures, measureName);
		if (_.isEqual(updated, measures)) {
			return;
		}

		activeContent.startBatch();
		activeContent.updateAttr(activeContent.id, configAttributeName, updated);
		activeContent.traverse(function (idea) {
			activeContent.mergeAttrProperty(idea.id, valueAttrName, measureName,  false);
		});
		activeContent.endBatch();
	};
	self.validate = function (value) {
		return !isNaN(parseFloat(value)) && isFinite(value);
	};
	self.setValue = function (nodeId, measureName, value) {
		if (!self.validate(value)) {
			return false;
		}
		return activeContent.mergeAttrProperty(nodeId, valueAttrName, measureName, value);
	};
	self.getRawData = function (ignoreFilter) {
		var data = [];
		if (!activeContent) {
			return data;
		}
		data.push(['Name'].concat(measures));
		activeContent.traverse(function (idea) {
			if (ignoreFilter || !filter || filter.predicate(idea)) {
				data.push(
					[idea.title].concat(_.map(measures,
							function (measure) {
								var ideaMeasures = idea.getAttr(valueAttrName) || {},
									floatVal = ideaMeasures[measure] && parseFloat(ideaMeasures[measure]);
								if (floatVal !== undefined && !isNaN(floatVal)) {
									return floatVal;
								}
							})
						)
				);
			}
		});

		return data;
	};
	self.removeFilter = function () {
		if (filter && filter.cleanup) {
			filter.cleanup();
		}
		if (filter && filter.removeEventListener) {
			filter.removeEventListener('filteredRowsChanged', onFilterChanged);
		}
		filter = undefined;
	};
	self.editWithFilter(defaultFilter);
};
MM.MeasuresModel.filterByIds = function (ids) {
	'use strict';
	return {
		predicate: function (idea) {
			return _.include(ids, idea.id);
		}
	};
};

MM.MeasuresModel.ActivatedNodesFilter = function (mapModel) {
	'use strict';
	var self = observable(this),
		ids = mapModel.getActivatedNodeIds(),
		onFilteredResultsChange = function (force) {
			var newIds = mapModel.getActivatedNodeIds();
			if (force || ids !== newIds) {
				ids = newIds;
				self.dispatchEvent('filteredRowsChanged');
			}
		},
		onFilteredResultsChangeForced = onFilteredResultsChange.bind(self, true);
	mapModel.addEventListener('activatedNodesChanged', onFilteredResultsChange);
	mapModel.addEventListener('nodeTitleChanged', onFilteredResultsChangeForced);
	self.predicate = function (idea) {
		return _.include(ids, idea.id);
	};
	self.cleanup = function () {
		mapModel.removeEventListener('activatedNodesChanged', onFilteredResultsChange);
		mapModel.removeEventListener('nodeTitleChanged', onFilteredResultsChangeForced);
	};
};


jQuery.fn.editByActivatedNodesWidget = function (keyStroke, mapModel, measuresModel, splittableController) {
	'use strict';
	measuresModel.addEventListener('measureEditing', function (isEditing, nodeId) {
		if (isEditing && nodeId) {
			mapModel.selectNode(nodeId, true, true);
		}
		mapModel.setInputEnabled(!isEditing, true);
	});
	return jQuery.each(this, function () {
		var element = jQuery(this),
			toggleMeasures = function (force) {
				if (force || mapModel.getInputEnabled()) {
					splittableController.toggle();
				}
			};

		element.keydown(keyStroke, toggleMeasures.bind(element, false)).find('[data-mm-role=activatedNodesMeasureSheet]').click(toggleMeasures.bind(element, true));
	});
};
