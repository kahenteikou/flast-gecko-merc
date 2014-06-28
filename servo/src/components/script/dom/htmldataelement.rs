/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use dom::bindings::codegen::Bindings::HTMLDataElementBinding;
use dom::bindings::codegen::InheritTypes::HTMLDataElementDerived;
use dom::bindings::js::{JSRef, Temporary};
use dom::bindings::utils::{Reflectable, Reflector};
use dom::document::Document;
use dom::element::HTMLDataElementTypeId;
use dom::eventtarget::{EventTarget, NodeTargetTypeId};
use dom::htmlelement::HTMLElement;
use dom::node::{Node, ElementNodeTypeId};
use servo_util::str::DOMString;

#[deriving(Encodable)]
pub struct HTMLDataElement {
    pub htmlelement: HTMLElement
}

impl HTMLDataElementDerived for EventTarget {
    fn is_htmldataelement(&self) -> bool {
        self.type_id == NodeTargetTypeId(ElementNodeTypeId(HTMLDataElementTypeId))
    }
}

impl HTMLDataElement {
    pub fn new_inherited(localName: DOMString, document: &JSRef<Document>) -> HTMLDataElement {
        HTMLDataElement {
            htmlelement: HTMLElement::new_inherited(HTMLDataElementTypeId, localName, document)
        }
    }

    pub fn new(localName: DOMString, document: &JSRef<Document>) -> Temporary<HTMLDataElement> {
        let element = HTMLDataElement::new_inherited(localName, document);
        Node::reflect_node(box element, document, HTMLDataElementBinding::Wrap)
    }
}

pub trait HTMLDataElementMethods {
}

impl Reflectable for HTMLDataElement {
    fn reflector<'a>(&'a self) -> &'a Reflector {
        self.htmlelement.reflector()
    }
}
