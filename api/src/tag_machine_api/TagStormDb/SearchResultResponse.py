# automatically generated by the FlatBuffers compiler, do not modify

# namespace: TagStormDb

import flatbuffers
from flatbuffers.compat import import_numpy
np = import_numpy()

class SearchResultResponse(object):
    __slots__ = ['_tab']

    @classmethod
    def GetRootAs(cls, buf, offset=0):
        n = flatbuffers.encode.Get(flatbuffers.packer.uoffset, buf, offset)
        x = SearchResultResponse()
        x.Init(buf, n + offset)
        return x

    @classmethod
    def GetRootAsSearchResultResponse(cls, buf, offset=0):
        """This method is deprecated. Please switch to GetRootAs."""
        return cls.GetRootAs(buf, offset)
    # SearchResultResponse
    def Init(self, buf, pos):
        self._tab = flatbuffers.table.Table(buf, pos)

    # SearchResultResponse
    def DataType(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(4))
        if o != 0:
            return self._tab.Get(flatbuffers.number_types.Uint8Flags, o + self._tab.Pos)
        return 0

    # SearchResultResponse
    def Data(self):
        o = flatbuffers.number_types.UOffsetTFlags.py_type(self._tab.Offset(6))
        if o != 0:
            from flatbuffers.table import Table
            obj = Table(bytearray(), 0)
            self._tab.Union(obj, o)
            return obj
        return None

def SearchResultResponseStart(builder):
    builder.StartObject(2)

def Start(builder):
    SearchResultResponseStart(builder)

def SearchResultResponseAddDataType(builder, dataType):
    builder.PrependUint8Slot(0, dataType, 0)

def AddDataType(builder, dataType):
    SearchResultResponseAddDataType(builder, dataType)

def SearchResultResponseAddData(builder, data):
    builder.PrependUOffsetTRelativeSlot(1, flatbuffers.number_types.UOffsetTFlags.py_type(data), 0)

def AddData(builder, data):
    SearchResultResponseAddData(builder, data)

def SearchResultResponseEnd(builder):
    return builder.EndObject()

def End(builder):
    return SearchResultResponseEnd(builder)
