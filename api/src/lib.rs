use byteorder::{LittleEndian, ReadBytesExt};
use pyo3::{
	intern,
	prelude::*,
	types::{PyBytes, PyDict},
};
use std::io::{Cursor, Read};

#[pymodule]
fn parse(m: &Bound<'_, PyModule>) -> PyResult<()> {
	m.add_function(wrap_pyfunction!(parse_search_response_images, m)?)?;
	//m.add_class::<SearchResultImage>()?;
	Ok(())
}

// #[pyclass]
// struct SearchResultImage {
// 	#[pyo3(get)]
// 	id: Option<Py<PyInt>>,
// 	#[pyo3(get)]
// 	hash: Option<Py<PyBytes>>,
// 	#[pyo3(get)]
// 	tags: Option<Vec<(u64, u64)>>,
// 	#[pyo3(get)]
// 	attributes: Option<Py<PyDict>>,
// }

#[pyfunction]
fn parse_search_response_images(
	py: Python,
	has_ids: bool,
	has_hashes: bool,
	has_tags: bool,
	has_attributes: bool,
	data: &Bound<'_, PyBytes>,
) -> PyResult<Vec<PyObject>> {
	let api_mod = py.import("tag_machine_api")?;
	let py_class = api_mod.getattr("SearchResultImage")?;
	let mut cursor = Cursor::new(data.as_bytes());
	let mut images = Vec::new();
	let data_len = data.as_bytes().len() as u64;

	while cursor.position() < data_len {
		let image = py_class.call0()?;
		/*let mut image = SearchResultImage {
			id: None,
			hash: None,
			tags: None,
			attributes: None,
		};*/

		if has_ids {
			let image_id = cursor.read_u32::<LittleEndian>()?;
			//image.id = Some(image_id.into_pyobject(py)?.into());
			//image.setattr("id", image_id.into_pyobject(py)?)?;
			image.setattr(intern!(py, "id"), image_id)?;
		}

		if has_hashes {
			if cursor.position() + 32 > data_len {
				return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Buffer overflow while parsing image hash"));
			}
			let hash_slice = &data.as_bytes()[cursor.position() as usize..(cursor.position() + 32) as usize];
			cursor.set_position(cursor.position() + 32);
			//image.hash = Some(PyBytes::new(py, hash_slice).into());
			image.setattr(intern!(py, "hash"), PyBytes::new(py, hash_slice))?;
		}

		if has_tags {
			let num_tags = read_vli(&mut cursor)? as usize;
			let tag_dict = PyDict::new(py);
			for _ in 0..num_tags {
				let tag_id = read_vli(&mut cursor)?;
				let user_id = read_vli(&mut cursor)?;
				tag_dict.set_item(tag_id, user_id)?;
			}
			//image.tags = Some(tag_list);
			image.setattr(intern!(py, "tags"), tag_dict)?;
		}

		if has_attributes {
			let num_keys = read_vli(&mut cursor)? as usize;
			let attributes = PyDict::new(py);
			for _ in 0..num_keys {
				let key_str = read_string(&mut cursor)?;
				let num_values = read_vli(&mut cursor)? as usize;
				let value_dict = PyDict::new(py);
				for _ in 0..num_values {
					let val_str = read_string(&mut cursor)?;
					let user_id = read_vli(&mut cursor)?;
					value_dict.set_item(val_str, user_id)?;
				}
				attributes.set_item(key_str, value_dict)?;
			}
			//image.attributes = Some(attributes.into());
			image.setattr(intern!(py, "attributes"), attributes)?;
		}

		images.push(image.into());
	}

	Ok(images)
}


/// Read a variable-length integer from a reader
fn read_vli<R: Read>(mut reader: R) -> Result<u64, std::io::Error> {
	let byte = reader.read_u8()?;

	Ok(match byte {
		0xfd => reader.read_u16::<LittleEndian>()? as u64,
		0xfe => reader.read_u32::<LittleEndian>()? as u64,
		0xff => reader.read_u64::<LittleEndian>()?,
		_ => byte as u64,
	})
}


/// Read a string from a reader
fn read_string<R: Read>(mut reader: R) -> Result<String, std::io::Error> {
	let len = read_vli(&mut reader)?;
	let mut bytes = vec![0u8; len as usize];
	reader.read_exact(&mut bytes)?;
	let s = String::from_utf8(bytes).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
	Ok(s)
}
